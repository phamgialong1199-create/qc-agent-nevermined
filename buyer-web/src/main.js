import { Payments } from '@nevermined-io/payments';
import './style.css';
const app=document.querySelector('#app');
app.innerHTML=`<main><h1>QC Agent</h1><p>Thanh toán $1/lượt qua Nevermined</p><section><h2>Kết nối Nevermined</h2><p>Đăng nhập và cấp quyền trực tiếp với Nevermined. Trang này không yêu cầu Buyer API Key.</p><button id="connect">Kết nối Nevermined</button><p id="status" role="status"></p></section><section><h2>Token x402</h2><p>Đang xác minh Nevermined có hỗ trợ cấp token Visa card-delegation từ phiên đăng nhập trình duyệt hay không. Không yêu cầu nhập khóa bí mật.</p><p><a href="https://nevermined.app/" target="_blank" rel="noopener noreferrer">Mở Nevermined</a></p></section><section><a href="https://qc-agent-nevermined.onrender.com/">Quay lại QC Agent</a></section></main>`;
const status=document.querySelector('#status');
document.querySelector('#connect').onclick=async()=>{
 try{
  status.textContent='Đang chuyển sang Nevermined...';
  const payments=Payments.getBrowserInstance({returnUrl:location.origin+location.pathname,environment:'live'});
  await payments.connect();
  status.textContent='Đã gọi chức năng kết nối Nevermined. Kiểm tra trạng thái đăng nhập trên trang Nevermined.';
 }catch(e){status.textContent='Chưa kết nối được: '+(e?.message||String(e));}
};
