// One durable claim per purchase; a v3 token remains globally single-use.
export function createPaidImageHandler({payments, ledgerReady, claim, priorClaim, finishClaim,
  detectAccessTokenVersion, buildPaymentRequired, env, svg, logger = console}) {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64");
  const declined = (res,orderId) => res.status(402).json({
    error:"PAYMENT_DECLINED",orderId,providerCode:"BCK.X402.0049",
    paymentCaptured:false,retryable:false,
    message:"Visa/nhà cung cấp đã từ chối thanh toán; không thu được tiền cho đơn này. Kiểm tra thẻ hoặc đổi phương thức thanh toán trên Nevermined trước khi mua lại."
  });
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!payments) return res.status(503).json({error:"MISSING_CONFIG"});
    const network = env.NVM_PAYMENT_NETWORK || "stripe";
    const paymentRequired = buildPaymentRequired(env.NVM_PLAN_ID, {
      endpoint:"/paid-image", agentId:env.NVM_AGENT_ID, httpVerb:"POST",
      network, scheme:env.NVM_PAYMENT_SCHEME || (["stripe","visa","braintree"].includes(network) ? "nvm:card-delegation" : "nvm:erc4337"),
      description:"QC Agent test image"
    });
    const token = req.get("payment-signature");
    if (!token) return res.set("payment-required", b64(paymentRequired)).status(402).json({
      error:"PAYMENT_REQUIRED", message:"Supply payment-signature and a unique Idempotency-Key per purchase."
    });
    if (env.ENABLE_SETTLEMENT !== "true") return res.status(503).json({error:"SETTLEMENT_DISABLED"});
    if (token.length > 16384) return res.status(400).json({error:"TOKEN_TOO_LONG"});
    let hash, orderId, phase = "validation";
    try {
      if (!await ledgerReady()) return res.status(503).json({error:"POSTGRES_LEDGER_NOT_READY"});
      const version = detectAccessTokenVersion(token);
      if (version !== 2 && version !== 3) return res.status(402).json({error:"UNSUPPORTED_X402_TOKEN_VERSION"});
      if (version === 2 && env.ALLOW_X402_V2 !== "true")
        return res.status(503).json({error:"V2_REQUIRES_DURABLE_REPLAY_PROTECTION"});
      orderId = req.get("idempotency-key");
      if (!orderId || !/^[a-zA-Z0-9_-]{16,128}$/.test(orderId))
        return res.status(400).json({error:"IDEMPOTENCY_KEY_REQUIRED",
          message:"Use a new UUID for each intentional purchase. Reuse it when retrying the same purchase."});
      res.set("x-order-id", orderId);
      res.set("x402-token-version", String(version));
      phase = "claim";
      const attempt = await claim(token, orderId, version);
      hash = attempt.hash;
      if (!attempt.newClaim) {
        const prior = await priorClaim(hash);
        if (prior?.credential_hash && prior.credential_hash !== attempt.credentialHash)
          return res.status(409).json({error:"ORDER_TOKEN_MISMATCH",orderId});
        if (prior?.request_id !== orderId)
          return res.status(409).json({error:"TOKEN_ALREADY_USED_MINT_NEW_TOKEN"});
        if (prior?.status === "settled" && prior.receipt) {
          res.set("payment-response", b64(prior.receipt));
          res.set("idempotency-replayed", "true");
          return res.type("image/svg+xml").send(svg);
        }
        if (prior?.status === "rejected")
          return res.status(402).json({error:"PAYMENT_VERIFICATION_FAILED",orderId});
        if (prior?.status === "declined")
          return declined(res,orderId);
        return res.status(409).json({error:"PAYMENT_STATUS_UNCERTAIN_DO_NOT_RETRY",orderId});
      }
      phase = "verify";
      const verification = await payments.facilitator.verifyPermissions({
        paymentRequired, x402AccessToken:token, maxAmount:1n
      });
      if (verification?.isValid !== true) {
        await finishClaim(hash,"rejected");
        return res.status(402).json({error:"PAYMENT_VERIFICATION_FAILED",orderId});
      }
      phase = "settle";
      const settlement = await payments.facilitator.settlePermissions({
        paymentRequired, x402AccessToken:token, maxAmount:1n,
        agentRequestId:verification.agentRequest?.agentRequestId || verification.agentRequestId
      });
      const charged = settlement?.success === true && (settlement.billingModel === "pay-as-you-go"
        ? Boolean(settlement.orderTx || settlement.transaction)
        : Number(settlement.creditsRedeemed ?? "0") > 0);
      if (!charged) return res.status(502).json({
        error:"SETTLEMENT_NOT_CONFIRMED_CHECK_TRANSACTION_BEFORE_RETRY",orderId
      });
      phase = "save-receipt";
      await finishClaim(hash,"settled",settlement);
      res.set("payment-response",b64(settlement));
      return res.type("image/svg+xml").send(svg);
    } catch (error) {
      // Never log the token or provider error message: it can contain credentials.
      const rawCode = String(error?.code || "unknown");
      const code = /^(BCK\.[A-Z0-9.]+|http_\d{3}|network_error)$/.test(rawCode) ? rawCode : "unknown";
      logger.error("Payment error", {phase, orderId, code});
      // Official Nevermined catalog: .0049 is a definitive provider decline
      // with reservation rollback. .0048/timeouts remain ambiguous.
      if (phase === "settle" && code === "BCK.X402.0049") {
        try {
          await finishClaim(hash,"declined",{providerCode:code,paymentCaptured:false});
        } catch {
          // Retain the existing claim if the database is unavailable.
          logger.error("Payment decline persistence failed",{orderId,code});
        }
        return declined(res,orderId);
      }
      return res.status(502).json({error:"PAYMENT_UNCERTAIN_CHECK_NEVERMINED_BEFORE_RETRY",orderId,providerCode:code});
    }
  };
}

