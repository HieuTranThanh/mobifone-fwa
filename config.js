/* =====================================================================
   CẤU HÌNH HIỆU CHỈNH — BẢN ĐỒ VÙNG PHỦ FWA (5G/4G)
   =====================================================================
   File này là nơi DUY NHẤT cần sửa khi muốn hiệu chỉnh lại công thức tính
   bán kính vùng phủ (hoặc các tham số khác) — KHÔNG cần sửa app.js.

   Toàn bộ giá trị bên dưới sẽ ghi đè lên giá trị mặc định trong app.js.
   Muốn dùng lại giá trị mặc định của app.js: xoá dòng tương ứng ở đây.

   Sau khi sửa xong, lưu file rồi BẤM F5 lại trình duyệt để thấy thay đổi
   (không cần khởi động lại start-dev.bat) — trang KHÔNG tự tải lại được vì lý
   do bảo mật (CSP chặn đoạn script tự-reload của live-server), xem chi tiết
   trong CLAUDE.md mục "Quy trình dev".

   ---------------------------------------------------------------------
   NẾU SỬA MÀ KHÔNG THẤY GÌ THAY ĐỔI: mở Console của trình duyệt (F12 ->
   Console). Từ đợt audit 15/08/2026, mọi tham số sai đều được báo rõ ở đó:
     - gõ sai tên tham số  -> "config.js: bỏ qua tham số không tồn tại ..."
     - điền không phải số  -> "config.js: ... phải là số ..." (tự dùng mặc định)
     - ngưỡng đảo ngược    -> "config.js: ... đang lớn hơn ..."
   Trước đây các sai sót này bị bỏ qua trong im lặng: bản đồ vẫn hiện bình
   thường nhưng chạy bằng giá trị KHÁC với những gì ghi trong file này.

   LƯU Ý KHI ĐỔI GIÁ TRỊ: app.js có 1 bản sao giá trị mặc định (DEFAULT_CONFIG)
   dùng khi file này không tải được. File này luôn thắng lúc chạy, nên để lệch
   sẽ KHÔNG gây lỗi — chỉ khiến người đọc app.js hiểu sai thông số đang chạy.
   Sửa ở đây thì cập nhật luôn con số tương ứng trong DEFAULT_CONFIG.
   ===================================================================== */

window.APP_CONFIG = {

  /* ---------------------------------------------------------------
     LỚP BẢN ĐỒ MẶC ĐỊNH
     --------------------------------------------------------------- */

  // Lớp hiển thị khi mới mở web: "5G" hoặc "4G". Chỉ 1 lớp hiển thị tại 1
  // thời điểm (chuyển qua lại bằng công tắc 5G/4G trên sidebar) — xem lý do
  // trong CLAUDE.md, mục "Chỉ 1 lớp bản đồ tại 1 thời điểm".
  DEFAULT_ACTIVE_TECH: "5G",

  /* ---------------------------------------------------------------
     THIẾT BỊ TRẠM PHÁT 5G: Nokia AQHC (Massive MIMO Active Antenna, band n41)
     --------------------------------------------------------------- */

  // Tần số sóng mang thực tế đang phát (MHz) — lấy từ cấu hình cell thật.
  FREQ_MHZ: 2645,

  /* ---------------------------------------------------------------
     HIỆU CHỈNH THEO SỐ LIỆU THỰC TẾ (khuyến nghị — ưu tiên chỉnh ở đây)

     Thay vì tự dựng công thức từ công suất phát/độ lợi anten (các số này
     trên datasheet Nokia AQHC là EIRP/độ lợi beamforming trung bình toàn
     mảng, KHÔNG đại diện đúng cho tín hiệu tập trung hướng tới 1 CPE —
     đã thử dùng trực tiếp và ra bán kính hàng chục km, phi thực tế), công
     thức hiệu chỉnh (neo) theo "Expected cell size" đọc trực tiếp từ hệ
     thống quản lý mạng Nokia cho 1 trạm thực tế.
     --------------------------------------------------------------- */

  // "Expected cell size" (m) đọc từ hệ thống Nokia cho 1 trạm thực tế
  // (band n41, TDD, cell DLKTNN20DM5LA) — đây là bán kính kết nối cơ bản
  // (không đảm bảo tốc độ cao), không phải bán kính 300Mbps.
  REFERENCE_CELL_SIZE_M: 2100,

  // Độ cao anten (m) GIẢ ĐỊNH tương ứng với "Expected cell size" ở trên —
  // CHƯA xác nhận được độ cao thật của trạm DLKTNN20DM5LA. Nếu có độ cao
  // chính xác của trạm đó (hoặc 1 trạm khác có "Expected cell size" biết
  // trước), cập nhật lại đây để hiệu chỉnh chuẩn hơn.
  REFERENCE_ANTENNA_HEIGHT_M: 40,

  // SINR (dB) giả định tương ứng với "Expected cell size" — tức ngưỡng kết
  // nối cơ bản (điều chế thấp, KHÔNG đảm bảo tốc độ cao) mà Nokia dùng để
  // tính ra bán kính ở trên. Đây là giả định CẦN đội vô tuyến xác nhận lại
  // (thường 0dB là ngưỡng kết nối dữ liệu cơ bản kiểu QPSK).
  //   Tăng giá trị này -> bán kính 300Mbps tính ra sẽ TĂNG (khoảng cách
  //   giữa 2 ngưỡng SINR thu hẹp lại).
  //   Giảm -> bán kính 300Mbps sẽ giảm.
  REFERENCE_EDGE_SINR_DB: 0,

  // SINR tối thiểu (dB) để đạt tốc độ đầu cuối ≥300Mbps (điều chế cao,
  // VD 256QAM). Tăng -> bán kính vùng phủ THU NHỎ; giảm -> bán kính TĂNG.
  REQUIRED_SINR_DB: 18,

  // Suy hao xuyên tường/nhà (dB) khi CPE đặt TRONG NHÀ — khách hàng FWA hầu
  // như luôn lắp CPE trong nhà, không phải ngoài trời.
  //
  // LỊCH SỬ QUYẾT ĐỊNH: ban đầu dùng chung 10dB với 4G (đơn giản, cùng giả
  // định "nhà phố/nhà cấp 4 phổ biến"). Nhưng "quỹ" MAPL gốc của 5G vốn đã
  // nhỏ hơn nhiều (neo theo Expected cell size chỉ 2.1km, so với 4G không
  // neo theo cách này) và slope suy hao Hata của 5G dốc hơn (tần số
  // 2645MHz, ~34-38dB/decade so với ~30-32dB/decade của 4G ở cùng dải độ
  // cao anten) — nên cùng 10dB khiến bán kính 5G co lại rất sâu (~49%,
  // gây cảm giác quá siết so với 4G). Đã hạ xuống 6dB — thấp hơn 4G — với
  // lý do kỹ thuật: trạm 5G AQHC là Massive MIMO BEAMFORMING CHỦ ĐỘNG (tạo
  // búp sóng hướng thẳng tới từng CPE), khác hẳn anten panel tĩnh của 4G,
  // có thể bù lại một phần suy hao xuyên tường trong thực tế.
  //
  // TODO: đây vẫn là ước tính, CHƯA kiểm chứng bằng đo đạc thực tế mức bù
  // beamforming thật sự đạt được. Ưu tiên hiệu chỉnh sớm nếu có phản ánh
  // thực tế từ khách hàng (tốc độ không đạt hoặc dư thừa nhiều so với dự
  // kiến). Đây là tham số ẢNH HƯỞNG LỚN tới độ an toàn của bán kính.
  //   Tăng -> bán kính AN TOÀN thu hẹp lại; giảm -> bán kính tăng lên.
  INDOOR_PENETRATION_LOSS_DB_5G: 6,

  // Biên an toàn bổ sung (dB) cộng thêm ngoài phần tính toán ở trên, để
  // chủ động thu hẹp bán kính cho thận trọng hơn (VD khu vực nhiều
  // đồi núi/che khuất chưa được mô hình phản ánh hết). 0 = không cộng
  // thêm, giữ đúng theo số liệu tham chiếu.
  EXTRA_SAFETY_MARGIN_DB: 0,

  /* ---------------------------------------------------------------
     THIẾT BỊ ĐẦU CUỐI (CPE FWA) & MÔI TRƯỜNG
     --------------------------------------------------------------- */

  // Độ cao lắp đặt giả định của CPE so với mặt đất (m) — dùng trong hệ số
  // hiệu chỉnh của mô hình Hata (ảnh hưởng nhỏ, không cần chỉnh thường xuyên).
  CPE_HEIGHT_M: 3,

  // Hệ số hiệu chỉnh theo loại địa hình/đô thị của mô hình Hata (dB):
  //   0   = đô thị vừa/ngoại ô (mặc định, phù hợp đa số xã/thị trấn)
  //   +3  = đô thị lớn, mật độ nhà cao tầng dày đặc
  //   âm  = vùng nông thôn/mở rộng thoáng (bán kính sẽ tăng lên)
  CITY_CORRECTION_DB: 0,

  /* ---------------------------------------------------------------
     GIỚI HẠN & PHÂN LOẠI HIỂN THỊ
     --------------------------------------------------------------- */

  // Độ cao anten mặc định (m) dùng khi sheet thiếu dữ liệu cho 1 trạm.
  DEFAULT_ANTENNA_HEIGHT_M: 20,

  // Chặn bán kính tính ra trong khoảng [MIN, MAX] mét để tránh giá trị bất
  // thường nếu dữ liệu độ cao anten bị sai/thiếu. Đã TÍNH LẠI theo
  // INDOOR_PENETRATION_LOSS_DB_5G = 6dB: với phân bố độ cao anten 5G thật
  // (286 trạm, 11-53m), bán kính rơi trong khoảng ~287-463m — đặt MIN/MAX
  // rộng hơn 1 chút để không cắt cụt trường hợp ngoại lệ.
  MIN_RADIUS_M: 250,
  MAX_RADIUS_M: 490,

  /* ---------------------------------------------------------------
     TRẠM PHÁT 4G (band 1800MHz, RF module FXED/AHEB) — LINK-BUDGET CHUẨN

     Với 4G, mối lo không phải "có sóng hay không" (macro 4G phủ rộng, gần
     như luôn có sóng) mà là TRẠM CÓ ĐANG QUÁ TẢI HAY KHÔNG — nếu % PRB
     Utilization cao, CPE FWA lắp vào sẽ không đạt tốc độ dù có sóng. Vì vậy
     màu vòng tròn 4G tô theo % PRB Utilization (đọc thẳng từ sheet, số liệu
     thật), KHÔNG theo bán kính vùng phủ như 5G.

     LỊCH SỬ QUYẾT ĐỊNH: ban đầu định tái dùng kiến trúc "neo theo Expected
     cell size" giống 5G (đọc được expectedCellSize=15km thật từ 1 file
     commissioning XML trạm 4G thật — site DLKHPU03, band gsm1800). Nhưng đã
     BỎ hướng này sau khi chứng minh bằng số: expectedCellSize là trần thiết
     kế RACH/Timing-Advance (khoảng cách xa nhất còn phải đảm bảo truy cập
     ngẫu nhiên), cách xa cả chục lần so với bán kính dịch vụ tốt thực tế
     (~1km) — để ép công thức "neo + trừ SINR" về đúng thang ~1km cần chênh
     lệch SINR phi thực tế (~36-40dB, trong khi SINR tốt nhất thực tế hiếm
     khi vượt 25-30dB). Kết luận: 2 tham số cùng tên "Expected cell size"
     giữa 4G/5G không cùng bản chất, không neo lẫn được.

     THAY VÀO ĐÓ: dùng LINK-BUDGET CHUẨN (công suất phát + độ lợi anten −
     suy hao cáp − suy hao indoor → MAPL → giải ngược Hata). 4G dùng RF
     module thường (FXED/AHEB), KHÔNG phải Massive MIMO beamforming như
     AQHC của 5G — nên không vướng vấn đề "EIRP trung bình toàn mảng không
     đại diện đúng cho 1 CPE" đã khiến 5G phải bỏ link-budget. Link-budget
     đáng tin cậy hơn nhiều cho 4G.
     --------------------------------------------------------------- */

  // Băng tần LTE thực tế đang phát cho RF module FXED/AHEB (MHz).
  FREQ_MHZ_4G: 1800,

  // Độ cao anten mặc định (m) dùng khi sheet thiếu dữ liệu cho 1 trạm 4G.
  DEFAULT_ANTENNA_HEIGHT_M_4G: 30,

  // Chặn bán kính 4G tính ra trong khoảng [MIN, MAX] mét để tránh giá trị
  // bất thường nếu dữ liệu độ cao anten bị sai/thiếu. Với dải độ cao anten
  // 4G thật hiện có (5-71m) và bộ tham số dưới đây (mục tiêu 60Mbps), bán
  // kính tính ra rơi trong khoảng ~350-846m — trần/sàn đặt rộng rãi hơn 1
  // chút để không cắt cụt các trường hợp ngoại lệ.
  MIN_RADIUS_M_4G: 200,
  MAX_RADIUS_M_4G: 900,

  // Công suất phát tối đa (dBm) — SỐ THẬT đọc từ file commissioning XML
  // (tham số Nokia "pMax", đơn vị 0.1dBm — pMax=460 nghĩa là 46.0dBm).
  // Đọc từ 1 trạm 4G/1800MHz cụ thể (site DLKHPU03, cả 4 cell đều pMax=460).
  // Nếu có file commiss của trạm khác, đối chiếu lại xem có đồng nhất không.
  TX_POWER_DBM_4G: 46.0,

  // Suy hao cáp/feeder (dB) — SỐ THẬT đọc từ file commissioning XML (tham
  // số Nokia "totalLoss" trong ANTL, đơn vị 0.1dB — totalLoss=30 nghĩa là
  // 3.0dB). Đồng nhất ở mọi port anten trong file đã đọc.
  CABLE_LOSS_DB_4G: 3.0,

  // Độ rộng băng thông kênh (MHz) — SỐ THẬT đọc từ file commissioning XML
  // (tham số Nokia "dlChBw"). Ảnh hưởng trực tiếp tới nhiễu nền (noise
  // floor) và tốc độ tối đa có thể đạt. Nếu có trạm dùng băng thông khác
  // (10/15MHz), số liệu tính ra sẽ lạc quan/bi quan hơn thực tế trạm đó.
  CHANNEL_BANDWIDTH_MHZ_4G: 20,

  // TODO — CHƯA CÓ DATASHEET THẬT. Độ lợi anten trạm phát (dBi) — dùng giá
  // trị điển hình ngành cho anten panel LTE 1800MHz macro (thường 17-18dBi).
  // File commissioning KHÔNG lưu thông số này (thuộc hồ sơ khảo sát/
  // datasheet phần cứng anten, không phải cấu hình vô tuyến). Nếu biết
  // chính xác model anten đang lắp, cập nhật lại theo datasheet thật.
  ANTENNA_GAIN_DBI_4G: 17,

  // TODO — GIẢ ĐỊNH. Hệ số nhiễu (Noise Figure, dB) của máy thu CPE FWA —
  // dùng giá trị điển hình cho thiết bị CPE ngoài trời/gần cửa sổ (~7dB).
  UE_NOISE_FIGURE_DB_4G: 7,

  // Mục tiêu tốc độ tối thiểu (Mbps) để coi là AN TOÀN khi bán FWA 4G —
  // tương đương vai trò "≥300Mbps" của 5G, nhưng 4G nhắm mục tiêu thấp hơn
  // nhiều theo đúng thực tế công nghệ. Đây là số nghiệp vụ, thay đổi trực
  // tiếp theo yêu cầu kinh doanh — KHÔNG cần hiểu RF vẫn chỉnh được.
  // (Lịch sử: ban đầu 50, thử nâng lên 70 nhưng bán kính thu hẹp quá nhiều
  // — chốt lại 60 làm điểm cân bằng.)
  //   Tăng -> bán kính AN TOÀN thu hẹp lại; giảm -> bán kính tăng lên.
  TARGET_THROUGHPUT_MBPS_4G: 60,

  // TODO — GIẢ ĐỊNH, CỐ Ý BẢO THỦ. Hệ số hiệu suất thực tế so với dung
  // lượng lý tưởng Shannon (0-1) — quy đổi mục tiêu Mbps ở trên thành
  // ngưỡng SINR cần thiết. CỐ Ý KHÔNG cộng thêm gain từ 4x4 MIMO (dù trạm
  // có cấu hình Closed Loop MIMO 4x4 thật) vì điều kiện cell-edge thực tế
  // hiếm khi duy trì ổn định rank cao — ưu tiên an toàn (bán kính nhỏ hơn
  // thực tế) hơn là lạc quan (bán kính lớn hơn thực tế, dễ gây khiếu nại).
  //   Tăng (gần 1) -> bán kính TĂNG (lạc quan hơn).
  //   Giảm (gần 0) -> bán kính GIẢM (an toàn hơn).
  LINK_EFFICIENCY_FACTOR_4G: 0.5,

  // TODO — GIẢ ĐỊNH, CẦN HIỆU CHỈNH THEO THỰC TẾ KHÁCH HÀNG. Suy hao xuyên
  // tường/nhà (dB) khi CPE đặt TRONG NHÀ (khách hàng FWA hầu như luôn lắp
  // CPE trong nhà, không phải ngoài trời) — giá trị điển hình cho nhà phố/
  // nhà cấp 4 phổ biến ở Việt Nam (~10dB). Nhà bê tông nhiều tầng/tường dày
  // có thể cần giá trị lớn hơn (15-20dB); nhà cấp 4 mái tôn/vách nhẹ có thể
  // thấp hơn. Đây là tham số ẢNH HƯỞNG LỚN NHẤT tới độ an toàn của bán kính
  // — nên ưu tiên hiệu chỉnh sớm nếu có phản ánh thực tế từ khách hàng.
  //   Tăng -> bán kính AN TOÀN thu hẹp lại; giảm -> bán kính tăng lên.
  INDOOR_PENETRATION_LOSS_DB_4G: 10,

  // Biên an toàn bổ sung (dB) cho 4G, cùng ý nghĩa với EXTRA_SAFETY_MARGIN_DB
  // của 5G ở trên — dùng để thắt chặt thêm nếu sau này thấy vẫn chưa đủ an
  // toàn (khách hàng phản ánh tốc độ không đạt dù trong vòng tròn gợi ý).
  EXTRA_SAFETY_MARGIN_DB_4G: 0,

  // Ngưỡng (%) để tô màu vòng tròn theo % PRB Utilization — DÙNG CHUNG cho cả
  // 2 lớp 5G VÀ 4G (08/2026: cả 2 lớp giờ tô màu/chú giải/lọc theo PRB giống
  // hệt nhau, CHỈ khác công thức tính bán kính — xem CLAUDE.md mục "Chức năng
  // PRB dùng chung cho cả 2 lớp"). 4 mức:
  //   < PRB_BAND_VERY_LOW_MAX                    -> xanh dương (rất thấp, đẩy mạnh bán FWA)
  //   PRB_BAND_VERY_LOW_MAX .. LOW_MAX            -> xanh lá (thấp, an toàn để bán FWA)
  //   PRB_BAND_LOW_MAX .. MEDIUM_MAX              -> cam (trung bình, cân nhắc)
  //   > PRB_BAND_MEDIUM_MAX                       -> đỏ (nguy cơ nghẽn, không nên bán thêm)
  // Bảng màu khai báo ở PRB_BANDS trong app.js, chú giải bản đồ tự lấy
  // đúng màu đó nên không thể lệch nhau.
  // TODO — ĐÂY LÀ GIÁ TRỊ KHỞI ĐIỂM, chưa đối chiếu với ngưỡng nghiệp vụ thật
  // của nhà mạng — cần đội kinh doanh/vô tuyến hiệu chỉnh lại theo thực tế.
  PRB_BAND_VERY_LOW_MAX: 20,
  PRB_BAND_LOW_MAX: 40,
  PRB_BAND_MEDIUM_MAX: 70,

  // ===================================================================
  // HIỆU NĂNG HIỂN THỊ (không liên quan vô tuyến, không đổi số bán kính)
  // ===================================================================

  // Viewport culling: chỉ vẽ trạm nằm trong khung nhìn hiện tại, mở rộng thêm
  // bao nhiêu % mỗi phía (0.75 = rộng hơn 75%). Phần mở rộng này để trạm không
  // "bật ra" đột ngột khi kéo bản đồ — danh sách trạm hiển thị chỉ được tính
  // lại KHI NGƯỜI DÙNG DỪNG kéo, nên đệm càng nhỏ thì càng dễ thấy vùng trống
  // rồi trạm hiện ra sau khi thả tay.
  //   Giảm  -> vẽ ít trạm hơn, mỗi lần dừng kéo nhẹ hơn, nhưng dễ thấy "bật ra".
  //   Tăng  -> mượt khi kéo xa, nhưng vẽ nhiều trạm hơn.
  // Đo thực tế trên lớp 4G (1231 trạm), máy giả lập chậm 6x, sau khi icon trạm
  // đã chuyển sang vẽ bằng canvas: cả 2 mức đều đạt ~55fps khi kéo bản đồ, chỉ
  // khác ở nhịp xử lý 1 lần lúc vừa thả tay ở zoom xa nhất (0.75: ~110ms /
  // 0.3: ~77ms). Vì chênh lệch nhỏ mà nguy cơ "bật ra" rõ hơn, giữ 0.75.
  VIEWPORT_RENDER_PADDING: 0.75

};
