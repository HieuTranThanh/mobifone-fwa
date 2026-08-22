/* =====================================================
   BẢN ĐỒ VÙNG PHỦ FWA (5G/4G) — MobiFone
   -----------------------------------------------------
   Bố cục file (đọc từ trên xuống theo đúng luồng chạy):
     0. Điều kiện chạy bắt buộc (thư viện Leaflet)
     1. Cấu hình & hằng số
     2. Tham chiếu DOM & trạng thái ứng dụng
     3. Thông báo (toast) & trạng thái tải
     4. Tiện ích chung (text, số, hình học)
     5. Mô hình vô tuyến (Hata / link-budget) — KHÔNG đổi khi refactor
     6. Đọc dữ liệu Google Sheet -> danh sách trạm chuẩn hóa (+ cache)
     7. Dựng trạm trên bản đồ (circle/marker/popup)
     8. Vẽ bản đồ & viewport culling
     9. Tìm kiếm (địa chỉ/tọa độ/mã trạm/định vị)
    10. Xuất KML
    11. Panel/legend & khởi động
   ===================================================== */

/* =====================================================
   0. ĐIỀU KIỆN CHẠY BẮT BUỘC
   ===================================================== */

/* Leaflet được tải từ CDN (unpkg) và toàn bộ file này phụ thuộc vào nó ngay từ
   những dòng đầu. Ngoài hiện trường, việc thư viện KHÔNG tải được là chuyện có
   thật: mạng di động rớt giữa chừng, mạng nội bộ/khách sạn chặn CDN, hoặc SRI
   không khớp vì nội dung trên CDN bị đổi. Khi đó mọi thứ bên dưới ném lỗi ở
   dòng đầu tiên chạm tới `L`, init() không bao giờ chạy, và người dùng ngồi
   nhìn overlay "Đang tải dữ liệu trạm 5G/4G…" quay mãi mà không hiểu vì sao.
   Báo đúng nguyên nhân rồi dừng hẳn vẫn tốt hơn treo im lặng. */
if (!window.L) {
  const overlay = document.getElementById("initialLoadOverlay");
  if (overlay) {
    overlay.querySelector(".initial-load-spinner")?.remove();
    overlay.querySelector(".initial-load-text").textContent =
      "Không tải được thư viện bản đồ (Leaflet). Kiểm tra kết nối mạng rồi tải lại trang.";
  }
  throw new Error("Leaflet chưa được tải — dừng khởi tạo ứng dụng.");
}

/* =====================================================
   1. CẤU HÌNH & HẰNG SỐ
   ===================================================== */

// Giá trị mặc định dự phòng — để hiệu chỉnh thông số thực tế, sửa trong
// config.js (ghi đè qua window.APP_CONFIG), không cần đụng file logic này.
// LƯU Ý: giá trị ở đây phải được giữ ĐỒNG BỘ với config.js. config.js luôn
// thắng lúc chạy, nên default lệch sẽ không gây lỗi ngay nhưng khiến người đọc
// hiểu sai thông số đang chạy (đã từng lệch: PRB 50/75 ở đây vs 40/70 thật).
const DEFAULT_CONFIG = {
  SHEET_ID: "1tSQidcw2EH18BiBXxCySYFODcIzpe6u_",
  // GID của tab chứa danh sách trạm (1 tab duy nhất cho cả 4G lẫn 5G)
  SHEET_GID: "327893028",
  TRACKING_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbypr-0OMKp6UopO_-cET65QxdwTpeoMV9q13nJMdt3PBR-GtTHkKBrfHsdqTJR24bko/exec",
  MAX_SUGGESTED_POINTS: 3,

  // Lớp bản đồ hiển thị mặc định khi mới mở web: "5G" hoặc "4G"
  DEFAULT_ACTIVE_TECH: "5G",

  // Mô hình lan truyền sóng COST-231 Hata (trạm 5G) — ước tính tương đối,
  // cần đội vô tuyến kiểm chứng/hiệu chỉnh lại theo số liệu đo thực tế.
  FREQ_MHZ: 2645,
  CPE_HEIGHT_M: 3,
  CITY_CORRECTION_DB: 0,
  DEFAULT_ANTENNA_HEIGHT_M: 20,
  MIN_RADIUS_M: 250,
  MAX_RADIUS_M: 490,

  // Hiệu chỉnh theo "Expected cell size" thực tế đọc từ hệ thống Nokia
  // (trạm 5G Nokia AQHC Massive MIMO, band n41) thay vì tự dựng link-budget
  // từ công suất/độ lợi anten — các con số EIRP/độ lợi beamforming trên
  // datasheet không suy ra trực tiếp bán kính đơn-user được (đã kiểm chứng
  // ra kết quả phi thực tế nếu dùng thẳng).
  REFERENCE_CELL_SIZE_M: 2100,
  REFERENCE_ANTENNA_HEIGHT_M: 40,
  REFERENCE_EDGE_SINR_DB: 0,
  REQUIRED_SINR_DB: 18,
  INDOOR_PENETRATION_LOSS_DB_5G: 6,
  EXTRA_SAFETY_MARGIN_DB: 0,

  // Link-budget chuẩn cho trạm 4G (band 1800MHz, RF module FXED/AHEB —
  // KHÔNG phải Massive MIMO như 5G nên link-budget đáng tin cậy). TX_POWER/
  // CABLE_LOSS/CHANNEL_BANDWIDTH là số thật đọc từ file commissioning XML;
  // phần còn lại là giả định TODO — xem giải thích chi tiết trong config.js.
  FREQ_MHZ_4G: 1800,
  DEFAULT_ANTENNA_HEIGHT_M_4G: 30,
  MIN_RADIUS_M_4G: 200,
  MAX_RADIUS_M_4G: 900,
  TX_POWER_DBM_4G: 46.0,
  CABLE_LOSS_DB_4G: 3.0,
  CHANNEL_BANDWIDTH_MHZ_4G: 20,
  ANTENNA_GAIN_DBI_4G: 17,
  UE_NOISE_FIGURE_DB_4G: 7,
  TARGET_THROUGHPUT_MBPS_4G: 60,
  LINK_EFFICIENCY_FACTOR_4G: 0.5,
  INDOOR_PENETRATION_LOSS_DB_4G: 10,
  EXTRA_SAFETY_MARGIN_DB_4G: 0,

  // Ngưỡng phân loại màu vòng tròn theo % PRB Utilization — DÙNG CHUNG cho cả
  // 2 lớp 5G và 4G (08/2026: cả 2 giờ tô màu/lọc theo PRB giống hệt nhau, chỉ
  // khác công thức tính bán kính — xem CLAUDE.md). 4 mức: rất thấp / thấp /
  // trung bình / cao — xem getPrbBand().
  PRB_BAND_VERY_LOW_MAX: 20,
  PRB_BAND_LOW_MAX: 40,
  PRB_BAND_MEDIUM_MAX: 70,

  // Chỉ vẽ trạm nằm trong khung nhìn hiện tại (viewport culling), mở rộng thêm
  // % này mỗi phía (0.75 = rộng hơn 75%) để trạm không "bật ra" đột ngột khi
  // kéo bản đồ. Không ảnh hưởng số liệu (đếm trạm/export KML vẫn dùng toàn bộ
  // dữ liệu trong bộ nhớ, chỉ ảnh hưởng việc có vẽ layer lên map hay không).
  // LƯU Ý về mức độ tác dụng: culling chỉ giúp khi đã zoom vào; ở zoom mặc
  // định lúc mới mở web (fitBounds toàn bộ trạm) thì gần như MỌI trạm đều nằm
  // trong khung nhìn nên culling không bỏ được trạm nào — đó là lý do nó
  // KHÔNG phải cách sửa lag chính (xem chú thích icon canvas ở mục 7). Giải
  // thích trade-off và số đo: config.js.
  VIEWPORT_RENDER_PADDING: 0.75,

  STATION_CACHE_KEY: "fwaStationCache"
};

/* Tham số BẮT BUỘC dương (nằm trong log10() hoặc mẫu số của công thức vô
   tuyến / kích thước hiển thị). */
const POSITIVE_CONFIG_FIELDS = [
  "MAX_SUGGESTED_POINTS",
  "FREQ_MHZ", "CPE_HEIGHT_M", "DEFAULT_ANTENNA_HEIGHT_M", "MIN_RADIUS_M", "MAX_RADIUS_M",
  "REFERENCE_CELL_SIZE_M", "REFERENCE_ANTENNA_HEIGHT_M",
  "FREQ_MHZ_4G", "DEFAULT_ANTENNA_HEIGHT_M_4G", "MIN_RADIUS_M_4G", "MAX_RADIUS_M_4G",
  "CHANNEL_BANDWIDTH_MHZ_4G", "TARGET_THROUGHPUT_MBPS_4G", "LINK_EFFICIENCY_FACTOR_4G"
];

/* Tham số cho phép bằng 0 nhưng không được âm (suy hao/biên an toàn/ngưỡng %). */
const NON_NEGATIVE_CONFIG_FIELDS = [
  "INDOOR_PENETRATION_LOSS_DB_5G", "EXTRA_SAFETY_MARGIN_DB",
  "CABLE_LOSS_DB_4G", "UE_NOISE_FIGURE_DB_4G",
  "INDOOR_PENETRATION_LOSS_DB_4G", "EXTRA_SAFETY_MARGIN_DB_4G",
  "PRB_BAND_VERY_LOW_MAX", "PRB_BAND_LOW_MAX", "PRB_BAND_MEDIUM_MAX",
  "VIEWPORT_RENDER_PADDING"
];

/* Trộn config.js (window.APP_CONFIG) lên giá trị mặc định, có KIỂM TRA thay vì
   spread trần. Trước đây mọi thứ trong APP_CONFIG được nhận vô điều kiện: gõ
   sai tên hằng (VD thiếu hậu tố "_DB") thì giá trị hiệu chỉnh bị bỏ qua trong
   im lặng và bán kính vẫn hiện ra bình thường nhưng SAI — đúng loại lỗi khó
   phát hiện nhất với 1 file cấu hình do người không viết code chỉnh sửa.
   Ở đây mọi sai lệch đều được báo rõ ra console và tự rơi về giá trị mặc định
   an toàn, không bao giờ để công thức chạy với giá trị vô nghĩa (NaN). */
function resolveConfig(defaults, overrides) {
  const resolved = { ...defaults };

  if (!overrides || typeof overrides !== "object") {
    console.warn("Không thấy window.APP_CONFIG (config.js) — đang chạy bằng toàn bộ giá trị mặc định của app.js.");
  }

  for (const [key, value] of Object.entries(overrides || {})) {
    if (!(key in defaults)) {
      console.warn(`config.js: bỏ qua tham số không tồn tại "${key}" (sai chính tả?). Xem danh sách tên hợp lệ trong DEFAULT_CONFIG của app.js.`);
      continue;
    }

    if (typeof defaults[key] === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        console.error(`config.js: "${key}" phải là số, nhận được ${JSON.stringify(value)} — dùng mặc định ${defaults[key]}.`);
        continue;
      }
      resolved[key] = numeric;
      continue;
    }

    if (typeof value !== typeof defaults[key]) {
      console.error(`config.js: "${key}" sai kiểu dữ liệu — dùng mặc định ${JSON.stringify(defaults[key])}.`);
      continue;
    }
    resolved[key] = value;
  }

  if (resolved.DEFAULT_ACTIVE_TECH !== "4G") resolved.DEFAULT_ACTIVE_TECH = "5G";

  // Tham số nằm trong log10()/phép chia của mô hình vô tuyến: giá trị 0 hoặc
  // âm KHÔNG gây lỗi chạy mà cho ra ±Infinity/NaN, và bán kính NaN thì Leaflet
  // vẽ vòng tròn hỏng câm lặng — nguy hiểm hơn nhiều so với báo lỗi. Ở đây
  // chặn ngay tại nguồn và rơi về mặc định an toàn.
  for (const [key, isValid, rule] of [
    ...POSITIVE_CONFIG_FIELDS.map(key => [key, value => value > 0, "phải lớn hơn 0"]),
    ...NON_NEGATIVE_CONFIG_FIELDS.map(key => [key, value => value >= 0, "không được âm"])
  ]) {
    if (!isValid(resolved[key])) {
      console.error(`config.js: "${key}" ${rule}, nhận được ${resolved[key]} — dùng mặc định ${defaults[key]}.`);
      resolved[key] = defaults[key];
    }
  }

  // Ngưỡng đảo thứ tự sẽ làm phân loại màu vô nghĩa (VD dải "trung bình" rỗng)
  // mà không gây lỗi chạy — cảnh báo thay vì âm thầm hiển thị sai.
  const ordered = [
    ["MIN_RADIUS_M", "MAX_RADIUS_M"],
    ["MIN_RADIUS_M_4G", "MAX_RADIUS_M_4G"],
    ["PRB_BAND_VERY_LOW_MAX", "PRB_BAND_LOW_MAX"],
    ["PRB_BAND_LOW_MAX", "PRB_BAND_MEDIUM_MAX"]
  ];
  for (const [lower, upper] of ordered) {
    if (resolved[lower] > resolved[upper]) {
      console.error(`config.js: "${lower}" (${resolved[lower]}) đang lớn hơn "${upper}" (${resolved[upper]}) — kiểm tra lại ngưỡng.`);
    }
  }

  return resolved;
}

const CONFIG = resolveConfig(DEFAULT_CONFIG, window.APP_CONFIG);

// 2 lớp công nghệ của bản đồ. Chỉ 1 lớp hiển thị tại 1 thời điểm — xem lịch
// sử quyết định trong CLAUDE.md ("Chỉ 1 lớp bản đồ tại 1 thời điểm").
const TECHS = ["5G", "4G"];

// Tên cột trong Google Sheet (đọc theo TÊN HEADER, không theo thứ tự cột, để
// người dùng sheet đổi vị trí cột không làm hỏng app). Mỗi trường liệt kê các
// biến thể tên đã gặp/có thể gặp; so khớp sau khi chuẩn hóa (bỏ dấu, bỏ ký tự
// đặc biệt) nên không phân biệt hoa/thường hay khoảng trắng thừa.
const SHEET_COLUMNS = {
  siteId: ["Site_ID", "Site ID", "SiteID"],
  address: ["Địa chỉ mới", "Dia chi moi"],
  lng: ["Long (Kinh độ)", "Long", "Kinh độ"],
  lat: ["Lat (Vĩ độ)", "Lat", "Vĩ độ"],
  flag5G: ["5G"],
  height5G: ["Độ cao anten 5G (m)", "Do cao anten 5G (m)", "Độ cao anten 5G"],
  // KHÔNG dùng chung 1 tên "PRB Utilization (%)" không tiền tố công nghệ làm
  // phương án dự phòng cho cả 2 trường bên dưới: nếu sheet chỉ có 1 cột PRB
  // đặt tên kiểu đó (không rõ của 4G hay 5G), cả prb5G lẫn prb4G sẽ cùng khớp
  // vào ĐÚNG 1 cột đó và đọc nhầm dữ liệu của nhau trong im lặng — nguy hiểm
  // hơn nhiều so với việc báo thiếu cột (xem cảnh báo trong parseStationRecords).
  prb5G: ["5G PRB Utilization (%)", "5G PRB Utilization"],
  flag4G: ["4G"],
  height4G: ["Độ cao anten 4G (m)", "Do cao anten 4G (m)", "Độ cao anten 4G"],
  prb4G: ["4G PRB Utilization (%)", "4G PRB Utilization"]
};

// Thiếu 1 trong các cột này = coi như sai schema, chuyển sang dùng cache.
const REQUIRED_COLUMN_FIELDS = ["siteId", "address", "lng", "lat", "flag5G", "height5G"];

// Cột ĐỊNH DANH riêng của lớp 4G (cờ + độ cao anten) — CỐ Ý không bắt buộc:
// nếu bị đổi tên/xóa sau này, pipeline 5G (đang chạy ổn định) không được phép
// bị coi là lỗi schema. Khi thiếu, lớp 4G chỉ đơn giản hiển thị "0 trạm" kèm
// console.warn (khác cột PRB ở dưới — mất cột PRB không làm mất trạm nào).
const OPTIONAL_4G_IDENTITY_COLUMN_FIELDS = ["flag4G", "height4G"];

// Cột % PRB Utilization của từng lớp (08/2026: cả 5G lẫn 4G đều tô màu/lọc
// theo mức tải PRB) — CỐ Ý optional, KHÔNG thuộc REQUIRED_COLUMN_FIELDS: đây
// là cột LÀM GIÀU dữ liệu (mức tải), không phải cột định danh trạm (đó là
// flag5G/flag4G + tọa độ). Thiếu cột PRB của lớp nào thì lớp đó vẫn hiển thị
// đủ số trạm như cũ, chỉ là mọi trạm rơi vào mức "chưa có dữ liệu" (màu xám).
const OPTIONAL_PRB_COLUMN_FIELDS = ["prb5G", "prb4G"];

// Tăng số này khi đổi cấu trúc bản ghi trạm để cache cũ (localStorage của
// người dùng đã mở web trước đó) bị bỏ qua thay vì đọc nhầm định dạng cũ.
// v3 (08/2026): thêm trường prb5G vào bản ghi.
const STATION_CACHE_VERSION = 3;

/* Đệm autoPan cho popup (px). Leaflet chỉ biết popup phải nằm gọn trong KHUNG
   BẢN ĐỒ, nó KHÔNG biết bảng điều khiển và chú giải là 2 lớp phủ DOM nằm đè
   lên bản đồ — nên popup vẫn có thể mở ra ngay sau lưng chúng.
   Giá trị dưới đây chỉ là đệm TỐI THIỂU; đệm thật được tính lại theo kích
   thước THẬT của panel/chú giải ở mỗi lần mở popup — xem
   computePopupAutoPanPadding(). */
const POPUP_AUTOPAN_MIN_PADDING_PX = 16;

/* Khoảng hở giữa popup và mép lớp phủ (panel/chú giải) */
const POPUP_AUTOPAN_OVERLAY_GAP_PX = 12;

/* Trần đệm mỗi phía, theo tỷ lệ kích thước khung bản đồ. Nếu đệm ăn gần hết
   khung nhìn (màn hình rất nhỏ, panel đang mở), Leaflet sẽ không còn vùng hợp
   lệ nào để đặt popup và dời bản đồ lung tung — thà chấp nhận che một phần. */
const POPUP_AUTOPAN_MAX_RATIO = 0.45;

const CIRCLE_WEIGHT_NORMAL = 2;
const CIRCLE_WEIGHT_HIGHLIGHT = 4;

/* MỨC TẢI PRB — NGUỒN SỰ THẬT DUY NHẤT cho MỌI nơi nhắc tới mức tải: màu vòng
   tròn/icon trên bản đồ, chấm màu + thứ tự dòng trong chú giải và trong bộ lọc,
   badge/nhãn tiếng Việt trong popup, và ô đếm số trạm theo mức.

   Trước đây cùng một khái niệm bị tách thành 4 bảng song song (PRB_BAND_COLORS,
   PRB_BAND_ORDER, PRB_BAND_META, PRB_COUNT_DOM_BY_BAND) — thêm/bớt 1 mức phải
   sửa đúng 4 chỗ, quên 1 chỗ thì hoặc lệch màu, hoặc mất dòng đếm trong im
   lặng. Nay chỉ còn 1 mảng có THỨ TỰ (chính là thứ tự hiển thị), các bảng tra
   phía dưới đều suy ra từ nó.

   index.html KHÔNG chép lại mã màu hay nhãn: chấm màu lấy qua thuộc tính
   data-band-dot="<khóa mức>", ô đếm qua data-prb-count="<khóa mức>" — xem
   renderLegend()/updateLayerUI().

   LỊCH SỬ: trước 08/2026, 5G tô theo dải BÁN KÍNH (RADIUS_BAND_COLORS, đã gỡ)
   còn 4G tô theo % PRB Utilization — 2 thang màu khác ý nghĩa. Từ 08/2026 cả
   2 lớp đều tô theo PRB (đồng bộ hoàn toàn về hiển thị/lọc, chỉ còn khác công
   thức TÍNH bán kính — xem CLAUDE.md), nên chỉ còn đúng 1 bảng dùng chung. */
const PRB_BANDS = [
  { key: "veryLow", color: "#2563eb", badgeClass: "badge-primary", label: "Tải rất thấp — đẩy mạnh bán FWA" },
  { key: "low", color: "#22c55e", badgeClass: "badge-success", label: "Tải thấp — an toàn để bán FWA" },
  { key: "medium", color: "#f97316", badgeClass: "badge-warning", label: "Tải trung bình — cân nhắc trước khi bán" },
  // #dc2626 = --danger, #8593a8 = --ink-400 trong styles.css. 2 màu này CỐ Ý
  // trùng token của bộ thiết kế (đỏ "nguy hiểm" và xám "không có dữ liệu");
  // vòng tròn vẽ trên canvas nên vẫn phải khai báo mã màu ở đây, không dùng
  // được biến CSS. Đổi token trong styles.css thì đổi kèm ở đây.
  { key: "high", color: "#dc2626", badgeClass: "badge-danger", label: "Tải cao — không nên bán thêm FWA" },
  { key: "unknown", color: "#8593a8", badgeClass: "badge-neutral", label: "Chưa có dữ liệu PRB" }
];

const PRB_BAND_ORDER = PRB_BANDS.map(band => band.key);
const PRB_BAND_BY_KEY = Object.fromEntries(PRB_BANDS.map(band => [band.key, band]));

/* "Màn hình quá nhỏ để giữ bảng điều khiển mở" — quyết định 2 việc: thu gọn
   sẵn panel + chú giải lúc khởi động, và thu gọn panel trước khi mở popup
   (isMobileViewport / collapseControlBoxOnMobile).

   PHẢI xét CẢ CHIỀU CAO, không chỉ chiều rộng: điện thoại XOAY NGANG (VD
   iPhone 844x390, Android 740x360) rộng hơn 640px nên với điều kiện cũ nó bị
   coi là desktop — panel mở sẵn chiếm 92% chiều cao màn hình ngay khi vào web
   và không tự thu gọn khi chạm vào trạm, gần như không còn nhìn thấy bản đồ.
   Đã đo trên cả 2 kích thước trên.

   Chỉ đổi HÀNH VI (JS), KHÔNG đổi ngưỡng của khối @media(max-width:640px)
   trong styles.css: ở chế độ ngang, panel dạng sidebar hẹp của desktop mới là
   bố cục đúng, cái sai chỉ là để nó mở sẵn. */
const MOBILE_MEDIA_QUERY = "(max-width: 640px), (max-height: 480px)";

/* Bước di chuyển theo phím mũi tên trong nhóm lựa chọn (công tắc 5G/4G) */
const ARROW_KEY_STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/* Các lớp (pane) riêng để xếp thứ tự vẽ và tách việc hứng chuột — xem chú
   thích ở createStationPanes(). z-index chọn nằm giữa tilePane (200) và
   shadowPane (500) để popup/tooltip/marker vẫn ở trên cùng như mặc định. */
const STATION_CIRCLE_PANE = "stationCirclePane";
const STATION_ICON_PANE = "stationIconPane";
const SEARCH_OVERLAY_PANE = "searchOverlayPane";

/* Bán kính vùng chạm tối thiểu (px) của vòng tròn vùng phủ. Icon trụ phát sóng
   được vẽ thẳng vào canvas nên không còn là phần tử DOM 24x24 để chạm vào nữa
   (xem mục 7) — mọi click/tap đều do vòng tròn xử lý. Khi zoom xa, vòng tròn
   vài trăm mét chỉ còn 2-3px nên không thể chạm nổi; giá trị này bảo đảm vùng
   chạm luôn rộng ít nhất bằng icon, kể cả ở zoom nhỏ nhất. */
const STATION_MIN_TAP_RADIUS_PX = 13;

/* Icon trụ phát sóng vẽ trên canvas — kích thước khớp CSS của bản DOM cũ
   (.station-tower-icon svg: 18px, stroke-width 2.25, drop-shadow 0 1px 2px).
   Hộp sprite rộng hơn icon để chứa phần đổ bóng. */
const TOWER_SPRITE_BOX_PX = 28;
const TOWER_ICON_SIZE_PX = 18;
const TOWER_ICON_STROKE_WIDTH = 2.25;
const TOWER_ICON_VIEWBOX = 24;

/* Nhấp nháy icon trạm đang được gợi ý — thay cho CSS animation `.blink` của
   bản marker DOM cũ (canvas không có phần tử DOM để gắn animation). Giữ đúng
   dải mờ/rõ và chu kỳ của keyframes cũ; nhịp vẽ lại 70ms (~14fps) là đủ mượt
   cho hiệu ứng mờ dần mà không phải vẽ lại canvas ở 60fps. */
const TOWER_BLINK_PERIOD_MS = 1100;
const TOWER_BLINK_MIN_ALPHA = 0.28;
const TOWER_BLINK_STEP_MS = 70;

/* =====================================================
   2. THAM CHIẾU DOM & TRẠNG THÁI ỨNG DỤNG
   ===================================================== */

// Toàn bộ phần tử được truy cập từ JS gom về 1 chỗ (các id này do index.html
// bảo đảm — HTML và JS luôn deploy cùng nhau nên không cần kiểm tra null rải
// rác khắp file).
const dom = {
  toastContainer: document.getElementById("toastContainer"),
  topLoader: document.getElementById("topLoader"),
  initialLoadOverlay: document.getElementById("initialLoadOverlay"),
  controlBox: document.getElementById("controlBox"),
  controlToggle: document.getElementById("controlToggle"),
  legendBox: document.getElementById("legendBox"),
  legendToggle: document.getElementById("legendToggle"),
  legendPrbTechLabel: document.getElementById("legendPrbTechLabel"),
  // Chấm màu mức tải (chú giải + bộ lọc) và ô hiển thị ngưỡng % — cả 2 đều do
  // app.js điền vào từ đúng nguồn bản đồ đang dùng, index.html chỉ khai báo
  // "chỗ này là mức nào" / "chỗ này là ngưỡng nào". Xem renderLegend().
  bandDots: Array.from(document.querySelectorAll("[data-band-dot]")),
  legendThresholds: Array.from(document.querySelectorAll("[data-legend-threshold]")),
  panelTitleMain: document.getElementById("panelTitleMain"),
  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),
  suggestBox: document.getElementById("suggestBox"),
  stationInput: document.getElementById("stationSearchInput"),
  stationSuggestBox: document.getElementById("stationSuggestBox"),
  exportKmlBtn: document.getElementById("exportKmlBtn"),
  exportKmlBtnLabel: document.getElementById("exportKmlBtnLabel"),
  stationCountValue: document.getElementById("stationCountValue"),
  stationCountTechLabel: document.getElementById("stationCountTechLabel"),
  locateBtn: document.getElementById("locateBtn"),
  techSwitchButtons: Array.from(document.querySelectorAll(".tech-switch-btn")),
  prbFilter: document.getElementById("prbFilter"),
  prbFilterToggle: document.getElementById("prbFilterToggle"),
  prbFilterBadge: document.getElementById("prbFilterBadge"),
  prbFilterCheckboxes: Array.from(document.querySelectorAll(".prb-filter-checkbox")),
  // Ô đếm số trạm theo mức tải, tra theo khóa mức (data-prb-count="veryLow"...)
  prbCountByBand: new Map(
    Array.from(document.querySelectorAll("[data-prb-count]")).map(el => [el.dataset.prbCount, el])
  )
};

// Danh sách trạm theo từng lớp — build sẵn CẢ 2 lớp cùng lúc ngay sau khi tải
// sheet 1 lần; chuyển lớp chỉ vẽ lại map, không fetch lại.
const stationsByTech = { "5G": [], "4G": [] };

// Khung bao quanh toàn bộ trạm, tính 1 lần trong buildStations() — dùng để
// giới hạn phạm vi tìm địa chỉ (xem computeStationSearchBounds).
let stationSearchBounds = null;

// Lớp bản đồ đang hiển thị ("5G" hoặc "4G")
let activeTech = CONFIG.DEFAULT_ACTIVE_TECH === "4G" ? "4G" : "5G";

// Trạng thái checkbox lọc theo mức tải PRB — áp dụng CHO LỚP ĐANG CHỌN (từ
// 08/2026, cả 5G lẫn 4G đều tô màu/lọc theo PRB). Mặc định hiện toàn bộ, và
// RESET về hiện toàn bộ mỗi khi đổi lớp 5G/4G (switchActiveTech gọi
// resetPrbBandFilter()) — cố ý không nhớ riêng theo từng lớp, tránh trường
// hợp quên đang ẩn bớt trạm từ lượt xem lớp trước. Ảnh hưởng: trạm nào được
// VẼ lên bản đồ (updateVisibleStations), "Số trạm ... đang hiển thị"
// (updateLayerUI), và file xuất KML (exportActiveLayerToKml). KHÔNG ảnh
// hưởng tìm theo mã trạm/địa chỉ hay tìm trạm gần nhất — 2 tính năng đó vẫn
// quét toàn bộ trạm bất kể checkbox, để người dùng luôn tra được 1 trạm cụ
// thể kể cả khi đã ẩn bớt mức tải của nó (giống cách trạm đang được gợi ý vẫn
// hiện dù ngoài khung nhìn — xem station.highlighted).
const prbBandFilter = { veryLow: true, low: true, medium: true, high: true, unknown: true };

function resetPrbBandFilter() {
  for (const band of PRB_BAND_ORDER) prbBandFilter[band] = true;
  dom.prbFilterCheckboxes.forEach(checkbox => { checkbox.checked = true; });
}

// Vị trí đang tìm kiếm (double-click/nhập tọa độ/nhập địa chỉ/định vị) —
// dùng làm điểm xuất phát cho khoảng cách & link chỉ đường trong popup.
let searchOrigin = null;
let searchOriginMarker = null;

// Vòng tròn sai số của lần định vị GPS gần nhất
let accuracyCircle = null;

// Đường nối tới các trạm được gợi ý ở lượt tìm kiếm hiện tại
let suggestionLayers = [];

// Cờ dữ liệu đã sẵn sàng (đã build xong danh sách trạm)
let isDataReady = false;

// Chỉ fitBounds toàn bộ trạm ở lần vẽ đầu tiên
let isInitialLoad = true;

/* =====================================================
   3. THÔNG BÁO (TOAST) & TRẠNG THÁI TẢI
   (thay cho alert() mặc định của trình duyệt — không chặn thao tác)
   ===================================================== */

const TOAST_ICON = {
  info: "info",
  success: "check-circle-2",
  warning: "alert-triangle",
  danger: "alert-circle"
};

function showToast(message, { type = "info", duration = 5000 } = {}) {
  // Chỉ hiển thị 1 toast tại 1 thời điểm (toast mới nhất) — cần thiết vì có
  // luồng gọi showToast() lặp lại nhanh (double-click nhiều lần trên map ->
  // findNearestStations() cảnh báo mỗi lần), trước đây các toast giống hệt
  // nhau bị chồng lên nhau thay vì thay thế.
  Array.from(dom.toastContainer.children).forEach(old => {
    clearTimeout(old._dismissTimer);
    old.remove();
  });

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", type === "danger" ? "alert" : "status");

  toast.innerHTML = `
    <i data-lucide="${TOAST_ICON[type] || TOAST_ICON.info}" class="toast-icon"></i>
    <div class="toast-body">${escapeHtml(message)}</div>
    <button type="button" class="toast-close" aria-label="Đóng thông báo">
      <i data-lucide="x"></i>
    </button>
  `;

  const dismiss = () => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 150);
  };
  const armDismissTimer = () => {
    clearTimeout(toast._dismissTimer);
    toast._dismissTimer = setTimeout(dismiss, duration);
  };

  toast.querySelector(".toast-close").addEventListener("click", dismiss);
  // Giữ toast lại khi người dùng đang rê chuột đọc, hẹn giờ đóng LẠI khi rời
  // đi (trước đây chỉ hủy hẹn giờ nên toast bị "ghim" vĩnh viễn trên màn hình).
  toast.addEventListener("mouseenter", () => clearTimeout(toast._dismissTimer));
  toast.addEventListener("mouseleave", armDismissTimer);
  armDismissTimer();

  dom.toastContainer.appendChild(toast);
  refreshIcons();
}

function setLoadingIndicator(active) {
  dom.topLoader.classList.toggle("active", active);
}

/* Ẩn overlay che map lúc tải dữ liệu trạm lần đầu — gọi 1 lần khi loadData()
   xử lý xong (dù thành công, rơi về cache, hay lỗi hẳn). */
function hideInitialLoadOverlay() {
  dom.initialLoadOverlay.classList.add("hidden");
}

/* Chuyển các placeholder <i data-lucide="..."> vừa chèn động thành SVG. */
function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

/* =====================================================
   4. TIỆN ÍCH CHUNG (TEXT, SỐ, HÌNH HỌC)
   ===================================================== */

/* Chuẩn hóa text để SO KHỚP (không phải để hiển thị): bỏ dấu tiếng Việt, gộp
   khoảng trắng, đưa về chữ thường. normalize("NFD") tách dấu thành ký tự tổ
   hợp riêng nằm gọn trong dải U+0300-U+036F, nên chỉ cần 1 lần replace là bỏ
   sạch dấu (trước đây phải tách chuỗi thành mảng ký tự rồi lọc theo mã — cùng
   kết quả nhưng dài dòng và tốn hơn ở >1400 trạm). */
function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeHeader(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* Text dùng để HIỂN THỊ: chỉ cắt khoảng trắng thừa, giữ nguyên dấu và chữ
   hoa/thường đúng như người nhập sheet đã gõ. */
function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, ch => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  }[ch]));
}

/* Đọc số từ ô sheet: bỏ khoảng trắng và dấu %, tự nhận diện dấu thập phân là
   "," hay "." (ký tự phân cách xuất hiện SAU CÙNG được coi là dấu thập phân,
   các ký tự còn lại là phân cách hàng nghìn). Trả về NaN nếu không đọc được. */
function toNumber(value) {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/%/g, "");
  if (!cleaned) return NaN;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma === -1 && lastDot === -1) return Number(cleaned);

  const decimalSeparator = lastComma > lastDot ? "," : ".";
  const groupSeparator = decimalSeparator === "," ? "." : ",";
  const normalized = cleaned.split(groupSeparator).join("").replace(decimalSeparator, ".");

  return normalized ? Number(normalized) : NaN;
}

/* Kiểm tra tọa độ hợp lệ */
function validateLatLng(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (String(lat ?? "").trim() === "" || String(lng ?? "").trim() === "") return false;
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false;
  if (latNum === 0 && lngNum === 0) return false;

  return latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180;
}

/* Tính khoảng cách Haversine (mét) */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Chuyển circle Leaflet thành polygon cho KML */
function circleToPolygon(lat, lng, radiusMeters, points = 60) {
  const coords = [];
  const earthRadius = 6378137;

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);

    const dLat = dy / earthRadius;
    const dLng = dx / (earthRadius * Math.cos(lat * Math.PI / 180));

    const latPoint = lat + dLat * 180 / Math.PI;
    const lngPoint = lng + dLng * 180 / Math.PI;

    coords.push(`${lngPoint},${latPoint},0`);
  }

  return coords.join(" ");
}

/* Quy đổi màu hex sang định dạng màu KML (AABBGGRR). alphaHex BẮT BUỘC truyền
   tường minh: nền và viền của cùng 1 vòng tròn cố ý dùng 2 độ đục khác nhau
   (xem KML_FILL_ALPHA_HEX/KML_OUTLINE_ALPHA_HEX), một giá trị mặc định ẩn ở
   đây sẽ âm thầm làm sai 1 trong 2 nếu có nơi gọi quên truyền. */
function hexToKmlColor(hex, alphaHex) {
  // Chuẩn hóa về chữ thường: bảng màu trong app.js trộn cả "#DC2626" lẫn
  // "#2563eb", nếu chép nguyên si thì cùng 1 file KML có 2 kiểu viết màu —
  // Google Earth vẫn đọc được, nhưng khiến việc đối chiếu/diff file xuất ra
  // (và test tự động) trở nên rối vô ích.
  const clean = hex.replace("#", "").toLowerCase();
  const r = clean.substring(0, 2);
  const g = clean.substring(2, 4);
  const b = clean.substring(4, 6);
  return `${alphaHex}${b}${g}${r}`;
}

/* Độ đậm/nhạt vòng tròn khi xuất KML mở bằng Google Earth — nền vẫn mờ để
   còn nhìn thấy ảnh vệ tinh/tên đường bên dưới, nhưng VIỀN phải đục và
   NHUỘM ĐÚNG MÀU mức tải (không dùng 1 màu cố định cho mọi vòng như trước)
   để mắt phân định được ranh giới từng vòng khi nhiều trạm dày đặc chồng
   lấn nhau — đây đúng là nguyên nhân khiến bản đồ KML nhìn "nhòe" (phản ánh
   thực tế 08/2026): fill alpha cũ 0x7d (~49%) đã nhạt, viền lại tô cùng 1
   màu tím "854442" bất kể fill là đỏ/cam/xanh lá/xanh dương, nên vùng chồng
   lấn không còn phân biệt được đâu là ranh giới của vòng nào. */
const KML_FILL_ALPHA_HEX = "99"; // ~60% opacity, đậm hơn mặc định cũ 0x7d (~49%)
const KML_OUTLINE_ALPHA_HEX = "ff"; // viền luôn đục hẳn để nổi bật ranh giới
const KML_OUTLINE_WIDTH_PX = 2.5;

/* Thứ tự VẼ khi xuất KML — placemark đứng SAU trong tài liệu thì Google Earth
   vẽ ĐÈ LÊN TRÊN khi các vòng tròn chồng lấn (khu vực mật độ trạm cao, xem
   ảnh chụp thật người dùng phản ánh 20/08/2026). Trước đây không sắp xếp gì,
   thứ tự chồng lấn phụ thuộc thứ tự dòng trong sheet — 1 trạm "Tải cao" (cảnh
   báo quan trọng nhất về mặt kinh doanh: đừng bán thêm) có thể tình cờ bị 1
   trạm "Tải thấp/rất thấp" liền kề đè lên, khiến người xem tưởng khu vực đó
   an toàn. Nay luôn vẽ theo đúng thứ tự mức tải tăng dần, "Tải cao" vẽ SAU
   CÙNG nên luôn nổi lên trên ở vùng chồng lấn; "Chưa có dữ liệu" xếp đầu tiên
   (vẽ dưới cùng) vì không mang thông tin cảnh báo nào. */
const KML_DRAW_ORDER = ["unknown", "veryLow", "low", "medium", "high"];

/* Truy vấn kích thước màn hình được tạo 1 LẦN rồi dùng lại (isMobileViewport
   được gọi ở mọi lần chạm vào trạm) — matchMedia() tạo đối tượng mới mỗi lần
   gọi. Đối tượng này tự cập nhật khi xoay ngang/dọc màn hình. */
const mobileMediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);

function isMobileViewport() {
  return mobileMediaQuery.matches;
}

/* --- MẠNG: MỌI LỜI GỌI RA NGOÀI ĐỀU PHẢI CÓ HẠN GIỜ --------------------------
   fetch() của trình duyệt KHÔNG tự bỏ cuộc khi máy chủ nhận kết nối rồi im
   lặng (Chrome chờ tới hàng phút). Ngoài hiện trường với mạng di động chập
   chờn, điều đó có nghĩa là overlay "Đang tải dữ liệu trạm…" che kín bản đồ và
   web trông như bị treo — trong khi đúng ra phải rơi nhanh về dữ liệu cache.
   Hạn giờ cũng bảo đảm nút tìm kiếm/định vị luôn được bật lại. */
const NETWORK_TIMEOUT_MS = 15000;

/* Tải nội dung văn bản của 1 URL, hạn giờ tính cho TRỌN quá trình — kể cả lúc
   đọc thân phản hồi. Đây là chỗ dễ nhầm: fetch() được coi là xong ngay khi
   nhận đủ phần ĐẦU phản hồi, nên nếu tắt hạn giờ ngay lúc đó thì một kết nối
   đứt giữa chừng khi đang tải 500KB CSV vẫn treo vô hạn.
   `signal` (tùy chọn) cho phép bên gọi chủ động hủy sớm — dùng cho gợi ý địa
   chỉ khi người dùng gõ tiếp ký tự mới. */
async function fetchTextWithTimeout(url, { label = "Máy chủ", signal, ...init } = {}) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);

  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timer = setTimeout(
    () => controller.abort(new DOMException(`${label}: quá ${NETWORK_TIMEOUT_MS}ms không phản hồi`, "TimeoutError")),
    NETWORK_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${label} trả về HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abortFromCaller);
  }
}

/* Người dùng chủ động hủy (gõ tiếp ký tự mới) — không phải lỗi cần báo */
function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}

/* =====================================================
   5. MÔ HÌNH VÔ TUYẾN (HATA / LINK-BUDGET)
   Toàn bộ công thức & tham số ở mục này quyết định con số bán kính hiển thị
   cho kinh doanh — chỉ đổi khi có số liệu vô tuyến mới, không đổi vì lý do
   dọn dẹp code. Lịch sử quyết định: xem CLAUDE.md và config.js.
   ===================================================== */

/* Hệ số hiệu chỉnh độ cao thiết bị đầu cuối (CPE) trong mô hình Hata */
function hataMobileHeightCorrection(hr) {
  return 3.2 * Math.pow(Math.log10(11.75 * hr), 2) - 4.97;
}

/* Độ dốc suy hao theo khoảng cách (mô hình COST-231 Hata) ứng với độ cao anten trạm */
function hataPathLossSlope(hb) {
  return 44.9 - 6.55 * Math.log10(hb);
}

/* Suy hao cơ bản (chưa cộng thành phần theo khoảng cách) ứng với độ cao anten trạm */
function hataBaseLoss(hb, techParams) {
  const aHr = hataMobileHeightCorrection(techParams.cpeHeightM);
  return 46.3 + 33.9 * Math.log10(techParams.freqMhz) - 13.82 * Math.log10(hb) - aHr + techParams.cityCorrectionDb;
}

/*
MAPL (Maximum Allowable Path Loss, dB) cho 5G — hiệu chỉnh (neo) theo
"Expected cell size" thực tế đọc trên hệ thống Nokia (ứng với 1 trạm tham
chiếu ở độ cao REFERENCE_ANTENNA_HEIGHT_M, tại ngưỡng kết nối cơ bản
REFERENCE_EDGE_SINR_DB), KHÔNG tự dựng từ công suất/độ lợi anten vì
Massive MIMO/beamforming khiến EIRP trung bình toàn mảng không đại diện
đúng cho tín hiệu hướng tới 1 CPE cụ thể (xem CLAUDE.md). Trừ thêm
INDOOR_PENETRATION_LOSS_DB_5G vì khách hàng FWA hầu như luôn lắp CPE
trong nhà, không phải ngoài trời.
*/
function computeMapl5G(techParams) {
  const referenceMapl = hataBaseLoss(CONFIG.REFERENCE_ANTENNA_HEIGHT_M, techParams)
    + hataPathLossSlope(CONFIG.REFERENCE_ANTENNA_HEIGHT_M) * Math.log10(CONFIG.REFERENCE_CELL_SIZE_M / 1000);

  return referenceMapl
    - (CONFIG.REQUIRED_SINR_DB - CONFIG.REFERENCE_EDGE_SINR_DB)
    - CONFIG.INDOOR_PENETRATION_LOSS_DB_5G
    - CONFIG.EXTRA_SAFETY_MARGIN_DB;
}

/* SINR (dB) cần thiết để đạt tốc độ mục tiêu targetMbps trên băng thông
   bwMHz, dùng dung lượng Shannon (log2(1+SINR)) chia cho 1 hệ số hiệu suất
   thực tế (< 1, luôn nhỏ hơn lý tưởng do overhead/điều chế rời rạc/lỗi ước
   lượng kênh...). Dùng chung cho mọi tính toán "quy đổi Mbps -> SINR". */
function requiredSinrDbFromTarget(targetMbps, bwMHz, efficiencyFactor) {
  const targetSpectralEfficiency = (targetMbps * 1e6) / (bwMHz * 1e6); // bps/Hz
  const shannonSpectralEfficiency = targetSpectralEfficiency / efficiencyFactor;
  const sinrLinear = Math.pow(2, shannonSpectralEfficiency) - 1;
  return 10 * Math.log10(sinrLinear);
}

/*
MAPL (dB) cho 4G — LINK-BUDGET CHUẨN (không neo theo expectedCellSize như
5G, xem lịch sử quyết định trong config.js): EIRP thật (TX_POWER_DBM_4G −
CABLE_LOSS_DB_4G + ANTENNA_GAIN_DBI_4G) trừ đi công suất thu tối thiểu cần
để đạt SINR mục tiêu (suy từ TARGET_THROUGHPUT_MBPS_4G qua
requiredSinrDbFromTarget), trừ tiếp suy hao indoor (khách hàng FWA lắp CPE
trong nhà) và biên an toàn bổ sung. 4G dùng RF module thường (không phải
Massive MIMO như 5G) nên link-budget đáng tin cậy, không vướng vấn đề EIRP
trung bình toàn mảng.
*/
function computeMapl4G() {
  const eirpDbm = CONFIG.TX_POWER_DBM_4G - CONFIG.CABLE_LOSS_DB_4G + CONFIG.ANTENNA_GAIN_DBI_4G;
  const noiseFloorDbm = -174 + 10 * Math.log10(CONFIG.CHANNEL_BANDWIDTH_MHZ_4G * 1e6) + CONFIG.UE_NOISE_FIGURE_DB_4G;
  const requiredSinrDb = requiredSinrDbFromTarget(
    CONFIG.TARGET_THROUGHPUT_MBPS_4G,
    CONFIG.CHANNEL_BANDWIDTH_MHZ_4G,
    CONFIG.LINK_EFFICIENCY_FACTOR_4G
  );
  const requiredRxPowerDbm = noiseFloorDbm + requiredSinrDb;

  return eirpDbm - requiredRxPowerDbm - CONFIG.INDOOR_PENETRATION_LOSS_DB_4G - CONFIG.EXTRA_SAFETY_MARGIN_DB_4G;
}

/* Gom tham số mô hình Hata + MAPL theo từng công nghệ ("5G"/"4G") thành 1
   object. MAPL được tính 1 lần theo đúng phương pháp riêng của từng công
   nghệ (5G: neo theo Expected cell size; 4G: link-budget) — xem
   computeMapl5G/computeMapl4G. CPE_HEIGHT_M/CITY_CORRECTION_DB dùng chung
   cho cả 2 (cùng 1 CPE vật lý, cùng địa hình) nên không nhân đôi.

   Tên hằng viết THẲNG chứ không ghép chuỗi theo hậu tố "_4G": cách ghép chuỗi
   khiến tìm kiếm "MIN_RADIUS_M_4G" trong app.js KHÔNG ra chỗ nào thật sự dùng
   nó, và gõ sai 1 ký tự thì chỉ nhận undefined -> bán kính NaN, không có lỗi
   nào chỉ ra nguyên nhân. */
function getTechParams(tech) {
  const is4G = tech === "4G";
  const techParams = {
    freqMhz: is4G ? CONFIG.FREQ_MHZ_4G : CONFIG.FREQ_MHZ,
    cpeHeightM: CONFIG.CPE_HEIGHT_M,
    cityCorrectionDb: CONFIG.CITY_CORRECTION_DB,
    defaultAntennaHeightM: is4G ? CONFIG.DEFAULT_ANTENNA_HEIGHT_M_4G : CONFIG.DEFAULT_ANTENNA_HEIGHT_M,
    minRadiusM: is4G ? CONFIG.MIN_RADIUS_M_4G : CONFIG.MIN_RADIUS_M,
    maxRadiusM: is4G ? CONFIG.MAX_RADIUS_M_4G : CONFIG.MAX_RADIUS_M
  };
  techParams.mapl = is4G ? computeMapl4G() : computeMapl5G(techParams);
  return techParams;
}

/*
Tính bán kính vùng phủ (m) theo độ cao anten trạm (m) và bộ tham số của 1
công nghệ (techParams, xem getTechParams — đã có sẵn MAPL tính theo đúng
phương pháp riêng của công nghệ đó), giải ngược mô hình lan truyền sóng
COST-231 Hata. Đây vẫn là ước tính tương đối, không thay thế đo kiểm thực tế.
*/
function computeCoverageRadius(antennaHeightM, techParams) {
  const hb = Number.isFinite(antennaHeightM) && antennaHeightM > 0
    ? antennaHeightM
    : techParams.defaultAntennaHeightM;

  const distanceKm = Math.pow(10, (techParams.mapl - hataBaseLoss(hb, techParams)) / hataPathLossSlope(hb));
  const radiusM = distanceKm * 1000;

  // Lưới an toàn cuối: bán kính NaN/Infinity sẽ khiến Leaflet vẽ vòng tròn
  // hỏng trong im lặng và popup hiện "NaN m". resolveConfig() đã chặn các
  // tham số vô nghĩa ngay tại nguồn, nhưng đây là con số duy nhất người dùng
  // kinh doanh thực sự nhìn vào nên vẫn giữ thêm 1 lớp kiểm tra.
  if (!Number.isFinite(radiusM)) {
    console.error("Bán kính tính ra không hợp lệ — kiểm tra lại tham số vô tuyến trong config.js.");
    return techParams.minRadiusM;
  }

  return Math.min(techParams.maxRadiusM, Math.max(techParams.minRadiusM, radiusM));
}

/* Phân loại mức tải PRB của 1 trạm (5G hoặc 4G) thành KHÓA mức — 5 khóa (4 mức
   + "chưa có dữ liệu"), dùng chung cho: màu vòng tròn/badge/nhãn trong popup,
   lọc hiển thị theo checkbox (prbBandFilter, xem mục 7/8) và đếm trạm theo mức
   trong panel (updateLayerUI). Tách khóa riêng khỏi phần hiển thị (PRB_BANDS)
   để mọi nơi dùng đều so khóa, không phải suy ngược từ nhãn tiếng Việt. Cùng 1
   ngưỡng CONFIG.PRB_BAND_* áp dụng cho cả 2 lớp — xem CLAUDE.md. */
function getPrbBandKey(prb) {
  if (!Number.isFinite(prb)) return "unknown";
  if (prb < CONFIG.PRB_BAND_VERY_LOW_MAX) return "veryLow";
  if (prb < CONFIG.PRB_BAND_LOW_MAX) return "low";
  if (prb < CONFIG.PRB_BAND_MEDIUM_MAX) return "medium";
  return "high";
}

function getPrbBand(prb) {
  return PRB_BAND_BY_KEY[getPrbBandKey(prb)];
}

/* =====================================================
   6. ĐỌC DỮ LIỆU GOOGLE SHEET -> DANH SÁCH TRẠM CHUẨN HÓA
   ===================================================== */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/* Dựng bảng dữ liệu từ CSV: xác định vị trí (chỉ số cột) của từng trường
   trong SHEET_COLUMNS + danh sách dòng dữ liệu.

   LƯU Ý QUAN TRỌNG — HEADER 2 DÒNG: sheet gốc có nhóm cột "Công nghệ" gộp
   header 2 dòng (dòng 1 để trống, dòng 2 mới ghi 2G/3G/4G/5G). Khi phát hiện
   trường hợp này, mượn tên ở dòng 2 cho ô header trống ở dòng 1 VÀ bỏ luôn
   dòng 2 khỏi phần dữ liệu (vì nó là header, không phải 1 trạm). Nếu sau này
   gặp lỗi "Không đọc được dữ liệu", kiểm tra trước tiên xem có phải do thay
   đổi cấu trúc header 2 dòng này không (tải thử CSV bằng curl để xem header
   thật, đừng vội nghi ngờ do quyền chia sẻ). */
function buildSheetTable(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return null;

  const headerRow = rows[0].map(cell => cell.trim());
  const subHeaderRow = (rows[1] || []).map(cell => cell.trim());
  const usesSubHeaderRow = headerRow.some((cell, index) => !cell && subHeaderRow[index]);
  const headers = headerRow.map((cell, index) => cell || subHeaderRow[index] || "");

  const headerIndex = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !headerIndex.has(key)) headerIndex.set(key, index);
  });

  // Chỉ số cột của từng trường, tra 1 lần cho cả sheet (trước đây dò lại theo
  // tên header cho từng ô của từng dòng — tốn ~hàng trăm nghìn phép chuẩn hóa
  // Unicode mỗi lần tải với >1500 dòng).
  const columns = {};
  for (const [field, aliases] of Object.entries(SHEET_COLUMNS)) {
    const matched = aliases.map(normalizeHeader).find(key => headerIndex.has(key));
    columns[field] = matched === undefined ? -1 : headerIndex.get(matched);
  }

  return { columns, dataRows: rows.slice(usesSubHeaderRow ? 2 : 1) };
}

function readCell(row, columnIndex) {
  return columnIndex >= 0 ? (row[columnIndex] ?? "") : "";
}

/* Ô đánh dấu công nghệ trong sheet: chỉ "x" mới tính là trạm có công nghệ đó */
function isTechFlagOn(value) {
  return normalizeText(value) === "x";
}

/* Độ cao anten hợp lệ (m) hoặc null nếu sheet trống/sai -> sẽ dùng độ cao
   mặc định của công nghệ và đánh dấu "ước tính" trong popup. */
function parseAntennaHeight(value) {
  const height = toNumber(value);
  return Number.isFinite(height) && height > 0 ? height : null;
}

/* % PRB Utilization hợp lệ (0-100) hoặc null nếu trống/sai/ngoài dải — không
   quy kết trạm là "an toàn" hay "nghẽn" khi số liệu không đáng tin. */
function parsePrbUtilization(value) {
  const prb = toNumber(value);
  return Number.isFinite(prb) && prb >= 0 && prb <= 100 ? prb : null;
}

/* Chuẩn hóa 1 bản ghi trạm — ĐỊNH DẠNG DUY NHẤT mà phần dựng bản đồ được phép
   nhận, dùng chung cho CẢ 2 nguồn dữ liệu: CSV mới tải và cache localStorage.
   Trả về null nếu bản ghi không dùng được (thiếu mã trạm / không đánh dấu công
   nghệ nào / tọa độ sai).

   Vì sao cache cũng phải đi qua đây: localStorage nằm ngoài tầm kiểm soát (bị
   sửa tay, hỏng giữa chừng, sót lại từ bản cũ). Trước đây cache chỉ được lọc
   sơ theo mã trạm + tọa độ nên 1 giá trị độ cao kiểu chuỗi vẫn lọt vào thẳng
   station.height, và popup gọi station.height.toFixed(1) sẽ NÉM LỖI ngay khi
   người dùng chạm vào trạm đó — lỗi chỉ xuất hiện ở nhánh offline nên rất khó
   phát hiện. Nay mọi trường số đều được ép kiểu ở một chỗ duy nhất.

   1 dòng sheet có thể vừa đánh dấu 4G vừa đánh dấu 5G (đã xác nhận bằng dữ
   liệu thật, ví dụ site DLBD05) -> 1 bản ghi phục vụ cả 2 lớp. */
function makeStationRecord(raw) {
  const siteId = cleanText(raw.siteId);
  const has5G = Boolean(raw.has5G);
  const has4G = Boolean(raw.has4G);
  const lat = toNumber(raw.lat);
  const lng = toNumber(raw.lng);

  if (!siteId || (!has5G && !has4G) || !validateLatLng(lat, lng)) return null;

  return {
    siteId,
    lat,
    lng,
    address: cleanText(raw.address),
    has5G,
    has4G,
    height5G: parseAntennaHeight(raw.height5G),
    height4G: parseAntennaHeight(raw.height4G),
    prb5G: parsePrbUtilization(raw.prb5G),
    prb4G: parsePrbUtilization(raw.prb4G)
  };
}

/* Chuyển CSV thô thành danh sách bản ghi trạm chuẩn hóa (độc lập với cấu
   trúc sheet). Đây cũng chính là định dạng được lưu cache: nhỏ hơn nhiều so
   với lưu nguyên CSV và không phải parse lại theo schema sheet khi đọc lại. */
function parseStationRecords(csvText) {
  const table = buildSheetTable(csvText);
  if (!table) throw new Error("CSV rỗng");

  const missingRequired = REQUIRED_COLUMN_FIELDS.filter(field => table.columns[field] < 0);
  if (missingRequired.length) {
    throw new Error(`Sheet thiếu cột bắt buộc: ${missingRequired.join(", ")}`);
  }

  const missing4G = OPTIONAL_4G_IDENTITY_COLUMN_FIELDS.filter(field => table.columns[field] < 0);
  if (missing4G.length) {
    console.warn(
      `Sheet thiếu cột 4G (${missing4G.join(", ")}) — hoặc cấu trúc header 2 dòng đã đổi. ` +
      "Lớp trạm 4G sẽ hiển thị 0 trạm."
    );
  }

  const missingPrb = OPTIONAL_PRB_COLUMN_FIELDS.filter(field => table.columns[field] < 0);
  if (missingPrb.length) {
    console.warn(
      `Sheet thiếu cột PRB Utilization (${missingPrb.join(", ")}) — trạm liên quan vẫn hiển thị ` +
      'bình thường, chỉ rơi vào mức "chưa có dữ liệu PRB".'
    );
  }

  const records = [];
  let droppedRows = 0;

  for (const row of table.dataRows) {
    const has5G = isTechFlagOn(readCell(row, table.columns.flag5G));
    const has4G = isTechFlagOn(readCell(row, table.columns.flag4G));
    // Dòng không đánh dấu công nghệ nào là chuyện bình thường (trạm 2G/3G),
    // không tính vào số dòng bị loại vì dữ liệu lỗi.
    if (!has5G && !has4G) continue;

    const record = makeStationRecord({
      siteId: readCell(row, table.columns.siteId),
      address: readCell(row, table.columns.address),
      lat: readCell(row, table.columns.lat),
      lng: readCell(row, table.columns.lng),
      has5G,
      has4G,
      height5G: readCell(row, table.columns.height5G),
      height4G: readCell(row, table.columns.height4G),
      prb5G: readCell(row, table.columns.prb5G),
      prb4G: readCell(row, table.columns.prb4G)
    });

    if (record) records.push(record);
    else droppedRows++;
  }

  // Trạm bị loại vì thiếu mã/tọa độ sai sẽ biến mất khỏi bản đồ trong im lặng —
  // báo ra console để người quản trị sheet còn biết đường sửa dữ liệu nguồn.
  if (droppedRows) {
    console.warn(`Bỏ qua ${droppedRows} dòng có đánh dấu 4G/5G nhưng thiếu Site_ID hoặc tọa độ không hợp lệ.`);
  }

  // Cùng 1 Site_ID xuất hiện ở nhiều DÒNG là lỗi dữ liệu nguồn (1 dòng đã đủ
  // mang cả cờ 4G lẫn 5G): bản đồ sẽ có 2 vòng tròn chồng khít nhau và "Số
  // trạm đang hiển thị" đếm gấp đôi — sai lệch âm thầm đúng vào con số mà
  // kinh doanh dùng để báo cáo.
  const duplicated = [...new Set(
    records.map(record => record.siteId).filter((id, index, all) => all.indexOf(id) !== index)
  )];
  if (duplicated.length) {
    console.warn(
      `Sheet có ${duplicated.length} mã trạm bị lặp ở nhiều dòng ` +
      `(${duplicated.slice(0, 10).join(", ")}${duplicated.length > 10 ? "…" : ""}) — ` +
      "mỗi mã sẽ hiện thành nhiều vòng tròn chồng nhau và bị đếm nhiều lần."
    );
  }

  return records;
}

/* Tải CSV của sheet trạm. Google Sheet chỉ cần chia sẻ "Anyone with the link
   – Viewer", KHÔNG cần Publish to web (đã kiểm chứng). */
async function fetchStationRecords() {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${CONFIG.SHEET_GID}`;
  const csvText = await fetchTextWithTimeout(url, { label: "Google Sheet", cache: "no-store" });

  return parseStationRecords(csvText);
}

/* --- Cache dự phòng (localStorage): dùng khi fetch lỗi (mất mạng/Google
       Sheet không truy cập được) để web vẫn dùng được với dữ liệu lần trước. */

function saveStationCache(records) {
  try {
    localStorage.setItem(CONFIG.STATION_CACHE_KEY, JSON.stringify({
      version: STATION_CACHE_VERSION,
      savedAt: Date.now(),
      records
    }));
  } catch (error) {
    console.warn("Không lưu được cache dữ liệu trạm:", error);
  }
}

function readStationCache() {
  try {
    const raw = localStorage.getItem(CONFIG.STATION_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STATION_CACHE_VERSION) return null;
    if (!Array.isArray(parsed.records) || !Number.isFinite(parsed.savedAt)) return null;

    // Cho cache đi qua ĐÚNG bộ chuẩn hóa của dữ liệu mới tải (makeStationRecord)
    // thay vì chỉ lọc sơ: localStorage nằm ngoài tầm kiểm soát nên mọi trường
    // đều phải được ép kiểu lại trước khi dựng layer/popup.
    const records = parsed.records
      .map(record => (record && typeof record === "object" ? makeStationRecord(record) : null))
      .filter(Boolean);
    if (!records.length) return null;

    return { savedAt: parsed.savedAt, records };
  } catch (error) {
    console.warn("Cache dữ liệu trạm không đọc được, sẽ bỏ qua:", error);
    return null;
  }
}

/* =====================================================
   7. DỰNG TRẠM TRÊN BẢN ĐỒ (CIRCLE / MARKER / POPUP)
   ===================================================== */

/* --- ICON TRỤ PHÁT SÓNG VẼ TRÊN CANVAS ---------------------------------

   LỊCH SỬ TỐI ƯU (quan trọng, đừng quay lại cách cũ): trước đây mỗi trạm là 1
   L.marker với divIcon chứa SVG — tức là >1200 phần tử DOM trong markerPane.
   Đo bằng Chromium (CPU throttle 4x, lớp 4G 1231 trạm) cho thấy ĐÂY là nguyên
   nhân lag chính, và gần như toàn bộ thời gian nằm ở phần việc NATIVE của
   trình duyệt (hit-test con trỏ, tính lại style, vẽ, ghép ảnh) chứ không phải
   ở JS của app:
     - kéo bản đồ:        ~126ms/frame (≈8fps)  ->  17ms (60fps)
     - di chuột trên map: ~137ms/frame          ->  17ms
     - zoom:              ~363ms/frame          ->  17ms
     - thêm toàn bộ layer (lúc tải & đổi lớp 5G↔4G): ~1230ms -> ~45ms
   Đã thử cách nhẹ hơn nhưng KHÔNG đủ: chỉ bỏ hứng chuột trên markerPane
   (pointer-events:none) chỉ giảm được ~1/3; bỏ interactive của vòng tròn
   (loại trừ hit-test canvas của Leaflet) không cải thiện gì.

   Cách đang dùng: icon được vẽ thẳng vào canvas như một layer vector, KHÔNG
   sinh phần tử DOM nào. Icon chỉ khác nhau ở màu và toàn bộ >1500 trạm chỉ
   dùng vài màu (3 dải bán kính 5G / 4 mức tải PRB 4G), nên mỗi màu chỉ cần
   rasterize 1 lần ra 1 canvas nhỏ (sprite) rồi drawImage lại cho mọi trạm —
   rẻ hơn nhiều so với stroke lại từng nét của icon ở mỗi lần vẽ. */

/* SVG "trụ phát sóng" (Lucide) dựng SẴN 1 LẦN DUY NHẤT làm nguồn hình cho
   sprite (Lucide chỉ dựng được SVG trong DOM nên phải qua 1 phần tử tạm). */
let cachedTowerIconSvgMarkup = null;

function getTowerIconSvgMarkup() {
  if (cachedTowerIconSvgMarkup !== null) return cachedTowerIconSvgMarkup;
  if (!window.lucide) return "";

  const temp = document.createElement("div");
  temp.style.cssText = "position:absolute; visibility:hidden; pointer-events:none;";
  temp.innerHTML = '<i data-lucide="radio-tower"></i>';
  document.body.appendChild(temp);
  lucide.createIcons();
  const svgEl = temp.querySelector("svg");
  cachedTowerIconSvgMarkup = svgEl ? svgEl.outerHTML : "";
  temp.remove();
  return cachedTowerIconSvgMarkup;
}

/* Chuyển các nét của icon Lucide thành danh sách Path2D (toạ độ theo viewBox
   24x24 gốc) để canvas stroke lại được. Đọc thẳng từ SVG do Lucide sinh ra
   nên đổi icon khác trong getTowerIconSvgMarkup() vẫn chạy, không phải chép
   tay dữ liệu đường nét. */
let cachedTowerStrokePaths = null;

function getTowerIconStrokePaths() {
  if (cachedTowerStrokePaths) return cachedTowerStrokePaths;
  cachedTowerStrokePaths = [];

  const markup = getTowerIconSvgMarkup();
  if (!markup || typeof Path2D !== "function") return cachedTowerStrokePaths;

  const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  for (const el of svg.children) {
    const path = svgShapeToPath2D(el);
    if (path) cachedTowerStrokePaths.push(path);
  }

  return cachedTowerStrokePaths;
}

/* 1 hình cơ bản của SVG Lucide -> Path2D (null nếu là thẻ không vẽ nét, VD
   <title>). Lucide chỉ dùng path/circle/line nên không cần hỗ trợ thêm. */
function svgShapeToPath2D(el) {
  const attr = name => Number(el.getAttribute(name));

  if (el.tagName === "path") {
    const d = el.getAttribute("d");
    return d ? new Path2D(d) : null;
  }

  if (el.tagName === "circle") {
    const path = new Path2D();
    path.arc(attr("cx"), attr("cy"), attr("r"), 0, Math.PI * 2);
    return path;
  }

  if (el.tagName === "line") {
    const path = new Path2D();
    path.moveTo(attr("x1"), attr("y1"));
    path.lineTo(attr("x2"), attr("y2"));
    return path;
  }

  return null;
}

/* Sprite icon theo màu — rasterize 1 lần cho mỗi màu rồi dùng lại cho mọi trạm
   cùng màu. Vẽ ở đúng độ phân giải mà Leaflet dùng cho canvas của nó
   (L.Browser.retina -> hệ số 2) để icon không bị mờ trên màn hình mật độ cao. */
const towerSpriteByColor = new Map();

function getTowerSprite(color) {
  const cached = towerSpriteByColor.get(color);
  if (cached) return cached;

  const scale = L.Browser.retina ? 2 : 1;
  const sprite = document.createElement("canvas");
  sprite.width = TOWER_SPRITE_BOX_PX * scale;
  sprite.height = TOWER_SPRITE_BOX_PX * scale;

  const ctx = sprite.getContext("2d");
  ctx.scale(scale, scale);

  // Đưa gốc toạ độ về giữa hộp sprite rồi thu viewBox 24x24 của Lucide về
  // đúng TOWER_ICON_SIZE_PX; các thông số nét/đổ bóng chia lại theo hệ số thu
  // nhỏ để kết quả trên màn hình khớp CSS của bản DOM cũ.
  const shrink = TOWER_ICON_SIZE_PX / TOWER_ICON_VIEWBOX;
  ctx.translate(TOWER_SPRITE_BOX_PX / 2, TOWER_SPRITE_BOX_PX / 2);
  ctx.scale(shrink, shrink);
  ctx.translate(-TOWER_ICON_VIEWBOX / 2, -TOWER_ICON_VIEWBOX / 2);

  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 2 / shrink;
  ctx.shadowOffsetY = 1 / shrink;

  const paths = getTowerIconStrokePaths();
  if (paths.length) {
    ctx.strokeStyle = color;
    ctx.lineWidth = TOWER_ICON_STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const path of paths) ctx.stroke(path);
  } else {
    // Dự phòng: nếu lucide lỗi/chưa load kịp thì vẽ 1 điểm tròn để tâm trạm
    // vẫn nhìn thấy được, không hiển thị trắng trơn.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(TOWER_ICON_VIEWBOX / 2, TOWER_ICON_VIEWBOX / 2, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  towerSpriteByColor.set(color, sprite);
  return sprite;
}

/* Layer icon trụ phát sóng: mượn toàn bộ phần "chiếu toạ độ + tính khung bao
   pixel + tham gia canvas renderer" của L.CircleMarker, chỉ thay phần vẽ.
   Nhờ vậy viewport culling, zoom, và vẽ lại từng vùng nhỏ (xem nhấp nháy ở
   mục 8) hoạt động y như mọi layer vector khác của Leaflet.
   `interactive: false` — mọi click/tap do vòng tròn vùng phủ xử lý (xem
   createStationPanes) nên 1 trạm chỉ có 1 popup duy nhất. */
const StationTowerIcon = L.CircleMarker.extend({
  options: {
    interactive: false,
    // Bán kính chỉ dùng để Leaflet tính khung bao pixel của layer (phục vụ
    // vẽ lại từng vùng) — phải trùm hết hộp sprite kể cả phần đổ bóng.
    radius: TOWER_SPRITE_BOX_PX / 2,
    towerSprite: null,
    towerAlpha: 1
  },

  _updatePath() {
    // Leaflet gọi _updatePath() cả ngoài lượt vẽ canvas (khi chỉ cần chiếu
    // lại toạ độ) — vẽ lúc đó sẽ đè ra ngoài vùng clip, nên phải kiểm tra
    // cờ _drawing đúng như _updateCircle() gốc của Leaflet.
    if (!this._renderer._drawing || this._empty()) return;

    const sprite = this.options.towerSprite;
    if (!sprite) return;

    const ctx = this._renderer._ctx;
    const alpha = this.options.towerAlpha;
    const half = TOWER_SPRITE_BOX_PX / 2;

    if (alpha < 1) {
      ctx.save();
      ctx.globalAlpha = alpha;
    }
    ctx.drawImage(
      sprite,
      this._point.x - half, this._point.y - half,
      TOWER_SPRITE_BOX_PX, TOWER_SPRITE_BOX_PX
    );
    if (alpha < 1) ctx.restore();
  }
});

/* Vòng tròn vùng phủ — chỉ khác L.circle ở vùng chạm tối thiểu, xem
   STATION_MIN_TAP_RADIUS_PX. */
const StationCircle = L.Circle.extend({
  _containsPoint(p) {
    const tapRadius = Math.max(this._radius, STATION_MIN_TAP_RADIUS_PX);
    return p.distanceTo(this._point) <= tapRadius + this._clickTolerance();
  }
});

/* Link Google Maps chỉ đường từ vị trí đang tìm kiếm tới trạm */
function renderDirection(lat, lng) {
  if (!searchOrigin) {
    return `<span class="popup-hint">Chưa xác định được vị trí tìm kiếm</span>`;
  }

  const url = `https://www.google.com/maps/dir/?api=1` +
    `&origin=${searchOrigin.lat},${searchOrigin.lng}` +
    `&destination=${lat},${lng}`;

  return `
    <a href="${url}" target="_blank" rel="noopener" class="popup-direction-link">
      <i data-lucide="navigation"></i> Chỉ đường đến trạm
    </a>
  `;
}

/* Dựng popup đầy đủ cho 1 trạm (theo station.tech). Hàm này được gắn vào
   bindPopup() dưới dạng HÀM, nên Leaflet tự gọi lại mỗi lần popup mở — nội
   dung phụ thuộc trạng thái (link chỉ đường theo vị trí tìm kiếm hiện tại,
   khối khoảng cách station.extraHtml khi trạm đang được gợi ý) luôn tươi mới
   mà không cần tự đồng bộ lại popup của circle lẫn marker bằng tay.
   08/2026: cả 5G lẫn 4G hiển thị GIỐNG HỆT nhau — % PRB Utilization làm thông
   tin chính (kèm badge cảnh báo tải), rồi tới "Bán kính phủ" (nhãn UI — bản
   chất vẫn là bán kính AN TOÀN, tính bằng công thức RIÊNG của từng công nghệ:
   5G neo theo Expected cell size, 4G link-budget cho TARGET_THROUGHPUT_MBPS_4G
   — ngưỡng nội bộ KHÔNG hiển thị số Mbps trên giao diện) — xem CLAUDE.md. */
function buildStationPopup(station) {
  const heightNote = station.heightEstimated
    ? ` <span class="popup-hint">(ước tính mặc định)</span>`
    : "";

  const prbText = Number.isFinite(station.prb) ? `${station.prb.toFixed(1)}%` : "Chưa có dữ liệu";
  const prbBand = getPrbBand(station.prb);
  const prbBadgeHtml = `<div class="popup-badges"><span class="badge ${prbBand.badgeClass}">${escapeHtml(prbBand.label)}</span></div>`;

  return `
    <div class="popup-card">
      <div class="popup-head">
        <span class="popup-head-icon"><i data-lucide="radio-tower"></i></span>
        <div>
          <div class="popup-eyebrow">Trạm ${station.tech}</div>
          <div class="popup-title">${escapeHtml(station.siteId)}</div>
        </div>
      </div>

      <dl class="popup-meta">
        <div class="popup-meta-row">
          <dt>Tọa độ</dt>
          <dd><a href="https://www.google.com/maps?q=${station.lat},${station.lng}" target="_blank" rel="noopener">${station.lat.toFixed(6)}, ${station.lng.toFixed(6)}</a></dd>
        </div>
        <div class="popup-meta-row">
          <dt>Địa chỉ</dt>
          <dd>${station.address ? escapeHtml(station.address) : '<span class="popup-hint">Chưa có địa chỉ trong dữ liệu</span>'}</dd>
        </div>
        <div class="popup-meta-row">
          <dt>Độ cao anten</dt>
          <dd>${station.height.toFixed(1)} m${heightNote}</dd>
        </div>
        <!-- Mức tải PRB là thông tin CHÍNH (đứng trước), rồi mới tới bán kính -->
        <div class="popup-meta-row">
          <dt>Mức tải PRB</dt>
          <dd class="popup-strong">${prbText}</dd>
        </div>
        <div class="popup-meta-row">
          <dt>Bán kính phủ</dt>
          <dd class="popup-strong">${Math.round(station.radius)} m</dd>
        </div>
      </dl>
      ${prbBadgeHtml}
      ${station.extraHtml}
      <div class="popup-direction-row">
        ${renderDirection(station.lat, station.lng)}
      </div>
    </div>
  `;
}

/* Đệm autoPan thật cho popup, tính theo kích thước HIỆN TẠI của 2 lớp phủ đè
   lên bản đồ (bảng điều khiển ở góc trên-trái, chú giải ở góc dưới-phải).

   Vì sao không dùng 1 hằng số cố định như trước: trên desktop bảng điều khiển
   là sidebar rộng ~308px, popup của trạm nằm phía trái màn hình mở ra là bị
   che một phần (đã đo bằng ảnh chụp thật: chồng lấn ~13% diện tích popup).
   Trước đây lỗi này được che đi bằng cách THU GỌN panel ở mọi lượt tìm kiếm —
   nhưng cách đó vừa không cứu được luồng chạm thẳng vào trạm trên bản đồ, vừa
   làm phiền người dùng desktop (mất luôn ô tìm kiếm vừa dùng). Nay tính đệm
   theo panel thật nên popup luôn nằm ở vùng trống, panel desktop giữ nguyên. */
function computePopupAutoPanPadding() {
  const size = map.getSize();
  const gap = POPUP_AUTOPAN_OVERLAY_GAP_PX;
  const pad = {
    left: POPUP_AUTOPAN_MIN_PADDING_PX,
    top: POPUP_AUTOPAN_MIN_PADDING_PX,
    right: POPUP_AUTOPAN_MIN_PADDING_PX,
    bottom: POPUP_AUTOPAN_MIN_PADDING_PX
  };

  // Bảng điều khiển: dạng sidebar hẹp (desktop) thì chừa chỗ theo CHIỀU NGANG;
  // dạng gần full-width (di động — và ở đó panel đã được thu gọn trước khi mở
  // popup, xem collapseControlBoxOnMobile) thì chừa theo CHIỀU DỌC.
  // Đệm được tính theo hệ tọa độ của KHUNG BẢN ĐỒ, còn getBoundingClientRect()
  // trả về tọa độ theo khung nhìn trình duyệt — trừ đi vị trí của khung bản đồ
  // để công thức vẫn đúng nếu sau này #map không còn phủ kín màn hình.
  const mapRect = map.getContainer().getBoundingClientRect();

  const panel = dom.controlBox.getBoundingClientRect();
  if (panel.width < size.x / 2) pad.left = Math.max(pad.left, panel.right - mapRect.left + gap);
  else pad.top = Math.max(pad.top, panel.bottom - mapRect.top + gap);

  // Chú giải neo ở góc dưới-phải: luôn chừa theo chiều dọc dưới (khối này thấp
  // nhưng khá rộng, chừa theo chiều ngang sẽ ăn mất phần lớn bề ngang bản đồ).
  const legend = dom.legendBox.getBoundingClientRect();
  pad.bottom = Math.max(pad.bottom, mapRect.bottom - legend.top + gap);

  const maxX = size.x * POPUP_AUTOPAN_MAX_RATIO;
  const maxY = size.y * POPUP_AUTOPAN_MAX_RATIO;

  return {
    autoPanPaddingTopLeft: L.point(Math.min(pad.left, maxX), Math.min(pad.top, maxY)),
    autoPanPaddingBottomRight: L.point(Math.min(pad.right, maxX), Math.min(pad.bottom, maxY))
  };
}

/* Chuẩn bị popup của 1 layer NGAY TRƯỚC khi nó mở: trên di động thu gọn bảng
   điều khiển, rồi cập nhật đệm autoPan theo layout vừa đổi.

   Thứ tự là bắt buộc và cũng là lý do hàm này phải được đăng ký làm listener
   'click' TRƯỚC .bindPopup(): Leaflet gọi listener theo đúng thứ tự đăng ký,
   nên panel phải thu gọn xong (và đệm phải tính xong) TRƯỚC khi listener nội
   bộ của bindPopup mở popup và tự autoPan. Đăng ký sau là đã quá trễ — autoPan
   sẽ tính theo layout cũ. Mọi luồng mở popup bằng code cũng phải gọi hàm này
   trước openPopup(). */
function prepareLayerPopup(layer) {
  collapseControlBoxOnMobile();
  const popup = layer.getPopup();
  if (popup) Object.assign(popup.options, computePopupAutoPanPadding());
}

/* Listener dùng CHUNG cho vòng tròn của mọi trạm (event.target chính là layer
   vừa được bấm) — tránh tạo hơn 1400 closure riêng, mỗi trạm một cái. */
function handleStationCircleClick(event) {
  prepareLayerPopup(event.target);
}

/* Dựng 1 trạm (dữ liệu + layer Leaflet) cho 1 công nghệ từ bản ghi sheet.
   Cả 5G lẫn 4G đều tô màu theo % PRB Utilization (08/2026, xem CLAUDE.md mục
   "Hiển thị theo PRB dùng chung cho cả 2 lớp") — chỉ 1 lớp được hiển thị tại
   1 thời điểm vì lý do khác: 1 trạm có thể vừa có 5G vừa có 4G cùng tọa độ,
   bán kính 2 công thức khác nhau nên 2 vòng tròn cùng thang màu sẽ chồng lấn
   không phân biệt được nếu hiện đồng thời. */
function createStation(record, tech, techParams) {
  const rawHeight = tech === "4G" ? record.height4G : record.height5G;
  const heightEstimated = rawHeight === null;
  const height = heightEstimated ? techParams.defaultAntennaHeightM : rawHeight;
  const radius = computeCoverageRadius(height, techParams);
  // 08/2026: cả 2 lớp đều tô màu/lọc theo % PRB Utilization — CHỈ còn khác
  // nhau ở công thức tính "radius" phía trên (xem CLAUDE.md). prb/prbBandKey/
  // color giờ tính giống hệt nhau cho 5G lẫn 4G, chỉ khác cột nguồn (prb5G so
  // với prb4G trong bản ghi).
  const prb = tech === "4G" ? record.prb4G : record.prb5G;
  // Khóa mức tải PRB (rất thấp/thấp/trung bình/cao/chưa có dữ liệu) — tính 1
  // lần ở đây, dùng lại cho cả màu vòng tròn LẪN lọc hiển thị theo checkbox
  // (prbBandFilter).
  const prbBandKey = getPrbBandKey(prb);
  const color = PRB_BAND_BY_KEY[prbBandKey].color;

  const station = {
    tech,
    siteId: record.siteId,
    lat: record.lat,
    lng: record.lng,
    address: record.address,
    height,
    heightEstimated,
    radius,
    prb,
    prbBandKey,
    color,
    // Khóa tìm kiếm chuẩn hóa sẵn 1 lần — ô tìm theo mã trạm quét toàn bộ
    // >1500 trạm ở MỖI phím gõ, chuẩn hóa Unicode tại chỗ sẽ giật trên di động.
    siteKey: normalizeText(record.siteId),
    addressKey: normalizeText(record.address),
    // Khối HTML phụ (khoảng cách/badge) chèn vào popup khi trạm đang được gợi ý
    extraHtml: "",
    // Trạm đang được gợi ý -> luôn giữ trên map (không bị viewport culling
    // giấu đi) và nhấp nháy icon để dễ nhận ra.
    highlighted: false,
    // Layer đã thực sự addTo(map) hay chưa (viewport culling)
    onMap: false
  };

  station.circle = new StationCircle([record.lat, record.lng], {
    pane: STATION_CIRCLE_PANE,
    radius,
    color,
    fillColor: color,
    fillOpacity: 0.35,
    weight: CIRCLE_WEIGHT_NORMAL
  });

  station.icon = new StationTowerIcon([record.lat, record.lng], {
    pane: STATION_ICON_PANE,
    towerSprite: getTowerSprite(color)
  });

  // Đăng ký TRƯỚC bindPopup() — xem chú thích thứ tự trong prepareLayerPopup().
  // Chỉ gắn trên vòng tròn: icon không hứng chuột, click vào icon sẽ rơi vào
  // vòng tròn bên dưới (xem createStationPanes) nên vẫn ra đúng popup này.
  station.circle.on("click", handleStationCircleClick);
  station.circle.bindPopup(() => buildStationPopup(station));

  return station;
}

/* Khung bao quanh toàn bộ trạm (cả 2 lớp) + đệm — dùng để giới hạn phạm vi tìm
   địa chỉ về đúng vùng có trạm, tránh Nominatim trả về địa danh trùng tên ở
   tỉnh khác. Chỉ đổi khi danh sách trạm đổi nên tính 1 lần ở buildStations(). */
function computeStationSearchBounds() {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

  for (const tech of TECHS) {
    for (const station of stationsByTech[tech]) {
      if (station.lat < minLat) minLat = station.lat;
      if (station.lat > maxLat) maxLat = station.lat;
      if (station.lng < minLng) minLng = station.lng;
      if (station.lng > maxLng) maxLng = station.lng;
    }
  }

  if (!Number.isFinite(minLat)) return null;

  const latPad = Math.max((maxLat - minLat) * 0.15, 0.05);
  const lngPad = Math.max((maxLng - minLng) * 0.15, 0.05);

  return {
    left: minLng - lngPad,
    top: maxLat + latPad,
    right: maxLng + lngPad,
    bottom: minLat - latPad
  };
}

/* Dựng cả 2 lớp trạm từ danh sách bản ghi (mỗi lớp tính tham số vô tuyến 1 lần) */
function buildStations(records) {
  for (const tech of TECHS) {
    const techParams = getTechParams(tech);
    const hasTech = tech === "4G" ? (record => record.has4G) : (record => record.has5G);
    stationsByTech[tech] = records
      .filter(hasTech)
      .map(record => createStation(record, tech, techParams));
  }

  stationSearchBounds = computeStationSearchBounds();
}

/* =====================================================
   8. VẼ BẢN ĐỒ & VIEWPORT CULLING
   ===================================================== */

const map = L.map("map", {
  doubleClickZoom: false,
  zoomControl: false,
  // Vẽ MỌI layer vector bằng canvas thay vì SVG mặc định của Leaflet — với
  // >1000 trạm hiển thị cùng lúc, SVG renderer phải cập nhật từng <path> riêng
  // lẻ mỗi lần pan/zoom nên rất lag; canvas gộp tất cả vào 1 bitmap duy nhất,
  // mượt hơn hẳn ở số lượng lớn. BẮT BUỘC giữ true: các pane riêng ở
  // createStationPanes() dựa vào tuỳ chọn này để Leaflet tự tạo canvas
  // renderer cho từng pane (nếu tắt, Leaflet sẽ tạo SVG renderer).
  // LƯU Ý: layer vẽ bằng canvas KHÔNG có phần tử DOM riêng (getElement() trả
  // về undefined) nên không gắn class CSS/animation lên được — hiệu ứng nhấp
  // nháy của icon trạm được vẽ bằng canvas (xem setStationHighlight).
  preferCanvas: true
}).setView([12.688165492644124, 108.05569162987426], 11);

/* 3 pane riêng, xếp thứ tự vẽ từ dưới lên: vòng tròn vùng phủ -> icon trạm ->
   lớp phủ của lượt tìm kiếm (đường nối, vòng tròn sai số GPS). Trước đây tất
   cả dùng chung 1 canvas ở overlayPane nên thứ tự vẽ phụ thuộc thứ tự trạm
   được thêm vào map (viewport culling thêm/bớt liên tục) — icon của trạm này
   có thể bị nền mờ của vòng tròn trạm khác vẽ đè lên.

   Vì sao 2 pane trên phải cho chuột XUYÊN QUA: mỗi canvas là 1 phần tử DOM
   phủ kín khung nhìn, canvas nằm trên sẽ hứng hết click/tap và canvas nằm
   dưới không bao giờ nhận được — nếu để mặc định thì bấm vào đâu cũng không
   mở được popup trạm. Cho xuyên qua thì mọi click/tap rơi xuống canvas vòng
   tròn, tức 1 trạm chỉ có 1 nơi xử lý click và 1 popup duy nhất (xem thêm
   STATION_MIN_TAP_RADIUS_PX cho trường hợp zoom xa, vòng tròn rất nhỏ). */
function createStationPanes() {
  const panes = [
    { name: STATION_CIRCLE_PANE, zIndex: 410, clickThrough: false },
    { name: STATION_ICON_PANE, zIndex: 450, clickThrough: true },
    { name: SEARCH_OVERLAY_PANE, zIndex: 460, clickThrough: true }
  ];

  for (const { name, zIndex, clickThrough } of panes) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
    if (clickThrough) pane.style.pointerEvents = "none";
  }
}

createStationPanes();

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

/* Danh sách trạm của lớp đang hiển thị — KHÔNG áp dụng bộ lọc PRB (dùng ở
   nơi cần quét toàn bộ trạm: tìm theo mã trạm/địa chỉ, tìm trạm gần nhất,
   tính khung bao tìm địa chỉ). Muốn danh sách đã lọc theo checkbox, dùng
   getFilteredActiveStations(). */
function getActiveStations() {
  return stationsByTech[activeTech];
}

/* true nếu mức tải PRB của trạm đang được checkbox cho hiện — áp dụng như
   nhau cho cả 5G lẫn 4G (prbBandFilter reset mỗi khi đổi lớp, xem
   resetPrbBandFilter). */
function isStationBandVisible(station) {
  return prbBandFilter[station.prbBandKey];
}

/* Danh sách trạm của lớp đang hiển thị, ĐÃ áp dụng checkbox lọc PRB — dùng
   cho những gì thực sự phản ánh "đang hiển thị": vẽ vòng tròn/icon lên bản đồ
   (updateVisibleStations), đếm số trạm (updateLayerUI), xuất KML
   (exportActiveLayerToKml). Trạm đang highlighted (đang được gợi ý/vừa tìm)
   LUÔN được tính là "đang hiển thị" dù mức tải của nó bị checkbox ẩn — khớp
   với updateVisibleStations() (highlighted ghi đè cả bounds lẫn checkbox lọc
   PRB khi VẼ), để "Số trạm đang hiển thị" và file KML không bao giờ thiếu
   đúng trạm người dùng vừa tìm ra.

   CỐ Ý KHÔNG tính thêm điều kiện isPopupOpen() như updateVisibleStations():
   điều kiện đó bên kia là lưới an toàn chống đệ quy của Leaflet (xem chú
   thích ở đó), không phải một quy tắc "thế nào là đang hiển thị". Nếu đưa
   vào đây thì con số đếm sẽ nhảy 1 đơn vị lúc mở/đóng popup, mà đóng popup
   lại không đi qua updateLayerUI() nên số hiển thị sẽ sai cho tới lần cập
   nhật sau — tệ hơn hẳn so với lệch tối đa 1 trạm giữa "đếm" và "đang vẽ",
   vốn đã là chuyện bình thường vì viewport culling. */
function getFilteredActiveStations() {
  return getActiveStations().filter(station => station.highlighted || isStationBandVisible(station));
}

function addStationToMap(station) {
  if (station.onMap) return;
  station.circle.addTo(map);
  station.icon.addTo(map);
  station.onMap = true;
}

function removeStationFromMap(station) {
  if (!station.onMap) return;
  map.removeLayer(station.circle);
  map.removeLayer(station.icon);
  station.onMap = false;
}

/* Nhấp nháy icon các trạm đang được gợi ý. Trước đây là CSS animation gắn lên
   phần tử DOM của marker; icon giờ vẽ trên canvas nên tự đổi độ mờ theo nhịp
   rồi yêu cầu Leaflet vẽ lại. redraw() của Leaflet chỉ xoá & vẽ lại đúng khung
   bao của layer đó (vài chục pixel) chứ không vẽ lại cả canvas, nên chi phí
   không phụ thuộc tổng số trạm. Bộ đếm chỉ chạy khi đang có trạm được gợi ý
   (nhiều nhất CONFIG.MAX_SUGGESTED_POINTS trạm). */
const blinkingStations = new Set();
let blinkTimer = null;

function drawBlinkFrame() {
  // Giữ đúng dải mờ/rõ và nhịp ease-in-out của keyframes `blink` cũ
  const phase = (performance.now() % TOWER_BLINK_PERIOD_MS) / TOWER_BLINK_PERIOD_MS;
  const wave = 0.5 + 0.5 * Math.cos(phase * 2 * Math.PI);
  const alpha = TOWER_BLINK_MIN_ALPHA + (1 - TOWER_BLINK_MIN_ALPHA) * wave;

  for (const station of blinkingStations) {
    station.icon.options.towerAlpha = alpha;
    station.icon.redraw();
  }
}

function setStationBlinking(station, blinking) {
  if (blinking) {
    blinkingStations.add(station);
    if (blinkTimer === null) {
      blinkTimer = setInterval(drawBlinkFrame, TOWER_BLINK_STEP_MS);
      drawBlinkFrame();
    }
    return;
  }

  blinkingStations.delete(station);
  station.icon.options.towerAlpha = 1;
  station.icon.redraw();

  if (!blinkingStations.size && blinkTimer !== null) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
}

function setStationHighlight(station, highlighted) {
  station.highlighted = highlighted;
  station.circle.setStyle({ weight: highlighted ? CIRCLE_WEIGHT_HIGHLIGHT : CIRCLE_WEIGHT_NORMAL });
  setStationBlinking(station, highlighted);
}

/* Viewport culling + lọc PRB: chỉ addTo(map) những trạm nằm trong khung nhìn
   hiện tại (mở rộng thêm đệm CONFIG.VIEWPORT_RENDER_PADDING mỗi phía) VÀ đang
   được checkbox mức tải PRB cho hiện (isStationBandVisible — áp dụng như nhau
   cho cả 5G lẫn 4G), cộng thêm các trạm đang được gợi ý (station.highlighted luôn giữ lại
   dù ở ngoài khung nhìn hoặc mức tải đang bị ẩn — mạng thưa, trạm gần nhất có
   thể ở khá xa, và người dùng cần thấy đúng trạm mình vừa tìm). Gọi lại mỗi
   khi bản đồ dừng pan/zoom (moveend), mỗi khi vẽ lại lớp, và mỗi khi đổi
   checkbox lọc PRB. Không đụng tới số liệu đếm/xuất KML — 2 chỗ đó tự lọc
   riêng qua getFilteredActiveStations(). */
function updateVisibleStations() {
  const stations = getActiveStations();
  if (!stations.length) return;

  // So sánh trực tiếp theo số thay vì bounds.contains([lat, lng]) — tránh tạo
  // hàng nghìn đối tượng LatLng tạm ở mỗi lần pan/zoom.
  const bounds = map.getBounds().pad(CONFIG.VIEWPORT_RENDER_PADDING);
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  for (const station of stations) {
    // KHÔNG BAO GIỜ gỡ trạm đang mở popup — đây là lưới an toàn chống ĐỆ QUY
    // của chính Leaflet, không phải điều kiện hiển thị cho đẹp:
    //   openPopup() -> Popup._adjustPan() dừng animation pan đang chạy ->
    //   Map._onPanTransitionEnd() -> fire("moveend") -> chính hàm này chạy
    //   LỒNG BÊN TRONG lượt mở popup. Nếu lúc đó trạm rơi ra ngoài khung nhìn
    //   (hoặc mức tải của nó đang bị lọc), nó bị gỡ ngay giữa chừng; sự kiện
    //   "remove" của layer mà bindPopup tự đăng ký sẽ đóng luôn popup và đặt
    //   popup._map = null, rồi _adjustPan chạy tiếp trên popup không còn map
    //   -> TypeError "Cannot read properties of null (reading
    //   'layerPointToContainerPoint')", popup không mở được.
    // Đã tái hiện được bằng: pan đang chạy + openPopup() một trạm ngoài khung
    // nhìn và không được highlight. Giữ lại trạm đang mở popup cũng đúng về
    // mặt hành vi — đó chính là trạm người dùng đang xem.
    const shouldShow = station.highlighted ||
      station.circle.isPopupOpen() ||
      (isStationBandVisible(station) &&
       station.lat >= south && station.lat <= north && station.lng >= west && station.lng <= east);

    if (shouldShow) {
      addStationToMap(station);
    } else {
      removeStationFromMap(station);
    }
  }
}

/* Vẽ lớp đang hiển thị. Lần đầu tiên có dữ liệu thì zoom vừa khít toàn bộ
   trạm; getBounds() đã phản ánh đúng view mới ngay sau fitBounds nên gọi
   updateVisibleStations() ngay được (không cần đợi animation). */
function renderActiveLayer() {
  const stations = getActiveStations();

  if (isInitialLoad && stations.length) {
    map.fitBounds(stations.map(station => [station.lat, station.lng]), { padding: [40, 40] });
    isInitialLoad = false;
  }

  updateVisibleStations();
}

/* Gỡ toàn bộ circle/marker (cả 2 lớp) khỏi map — không đụng tới dữ liệu trong
   bộ nhớ, dùng khi chuyển lớp hiển thị hoặc tải lại dữ liệu. */
function removeAllStationsFromMap() {
  for (const tech of TECHS) {
    stationsByTech[tech].forEach(removeStationFromMap);
  }
}

/* Xóa toàn bộ dấu vết của lượt tìm kiếm gần nhất: marker vị trí, vòng tròn sai
   số GPS, đường nối, và highlight/khối khoảng cách trong popup của MỌI lớp
   (trước đây chỉ reset lớp đang hiển thị, nên đổi lớp rồi quay lại vẫn còn
   trạm bị tô đậm kèm popup ghi khoảng cách của lượt tìm kiếm cũ). */
function clearSearchState() {
  suggestionLayers.forEach(layer => map.removeLayer(layer));
  suggestionLayers = [];

  if (searchOriginMarker) {
    map.removeLayer(searchOriginMarker);
    searchOriginMarker = null;
  }
  if (accuracyCircle) {
    map.removeLayer(accuracyCircle);
    accuracyCircle = null;
  }
  searchOrigin = null;

  for (const tech of TECHS) {
    for (const station of stationsByTech[tech]) {
      station.extraHtml = "";
      if (station.highlighted) setStationHighlight(station, false);
    }
  }
}

/* Chuyển lớp hiển thị 5G <-> 4G — dữ liệu 2 lớp đã có sẵn trong bộ nhớ
   (build 1 lần lúc load), chỉ cần vẽ lại map + cập nhật UI, không fetch lại.
   Bộ lọc PRB RESET về hiện toàn bộ ở mỗi lần đổi lớp (resetPrbBandFilter) —
   mỗi lớp có trạng thái lọc độc lập, tránh quên đang ẩn bớt trạm từ lớp
   trước đó khi quay lại xem lớp khác. */
function switchActiveTech(tech) {
  if (!TECHS.includes(tech) || tech === activeTech) return;

  clearSearchState();
  removeAllStationsFromMap();
  activeTech = tech;
  resetPrbBandFilter();

  renderActiveLayer();
  updateLayerUI();
}

/* Cập nhật mọi phần UI phụ thuộc lớp đang hiển thị & trạng thái dữ liệu: tiêu
   đề panel, legend, nút segmented switch, nhãn/nút export, đếm trạm, breakdown
   + checkbox lọc theo mức tải PRB. 08/2026: áp dụng GIỐNG HỆT nhau cho cả 5G
   lẫn 4G (trước đây chỉ 4G có phần PRB, 5G tính theo bán kính). */
function updateLayerUI() {
  const stations = getActiveStations();
  // "Đang hiển thị" tính theo đúng những gì thực sự được vẽ lên bản đồ/xuất
  // KML — tức đã trừ đi các mức tải đang bị bỏ tick.
  const visibleStations = getFilteredActiveStations();

  dom.panelTitleMain.textContent = `Tìm trạm ${activeTech} gần vị trí`;
  dom.stationCountTechLabel.textContent = activeTech;
  dom.legendPrbTechLabel.textContent = activeTech;

  dom.techSwitchButtons.forEach(btn => {
    const isActive = btn.dataset.tech === activeTech;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-checked", String(isActive));
    // "Roving tabindex": trong 1 radiogroup, chỉ mục ĐANG CHỌN nằm trong thứ
    // tự Tab; đổi lựa chọn bằng phím mũi tên (xem bindEvents). Nếu để cả 2 nút
    // cùng nhận Tab thì khai báo role="radiogroup" chỉ đúng một nửa: trình đọc
    // màn hình báo "1 trong 2" nhưng thao tác lại như 2 nút rời rạc.
    btn.tabIndex = isActive ? 0 : -1;
  });

  dom.exportKmlBtnLabel.textContent = `Xuất KML trạm ${activeTech}`;
  dom.exportKmlBtn.disabled = !isDataReady || visibleStations.length === 0;
  dom.stationCountValue.textContent = isDataReady ? visibleStations.length.toLocaleString("vi-VN") : "—";

  // Đếm theo TỔNG số trạm của mỗi mức trong LỚP ĐANG CHỌN (không phụ thuộc
  // checkbox mức khác đang bật/tắt) — breakdown phải ổn định để người dùng
  // biết chính xác đang ẩn đi bao nhiêu trạm khi bỏ tick 1 dòng.
  const counts = Object.fromEntries(PRB_BAND_ORDER.map(band => [band, 0]));
  for (const station of stations) counts[station.prbBandKey]++;

  // Tên mức sai trong index.html (data-prb-count="veryLo") sẽ cho counts[band]
  // = undefined và .toLocaleString() NÉM LỖI giữa updateLayerUI, làm hỏng cả
  // phần UI phía sau. Báo rõ ra console như renderLegend() đang làm với
  // data-band-dot/data-legend-threshold, thay vì gãy câm lặng.
  for (const [band, el] of dom.prbCountByBand) {
    if (!(band in counts)) {
      console.error(`Bộ lọc PRB: không có mức tải cho data-prb-count="${band}".`);
      continue;
    }
    el.textContent = isDataReady ? counts[band].toLocaleString("vi-VN") : "—";
  }

  // Khối lọc mặc định ĐÓNG, nên khi có mức bị bỏ tick phải nói rõ ngay trên
  // tiêu đề: nếu không, người dùng chỉ thấy "Số trạm đang hiển thị" ít đi mà
  // không hiểu vì sao (và có thể báo cáo nhầm con số đã bị lọc bớt).
  const checkedBands = PRB_BAND_ORDER.filter(band => prbBandFilter[band]).length;
  const isFiltering = checkedBands < PRB_BAND_ORDER.length;
  dom.prbFilterBadge.hidden = !isFiltering;
  dom.prbFilterBadge.textContent = isFiltering ? `Đang lọc ${checkedBands}/${PRB_BAND_ORDER.length}` : "";
}

/* =====================================================
   TẢI DỮ LIỆU
   ===================================================== */

/* Dựng lại cả 2 lớp trạm từ danh sách bản ghi rồi đồng bộ bản đồ + UI. Dùng
   chung cho dữ liệu mới tải và dữ liệu cache, để 2 nhánh không bao giờ lệch
   nhau về thứ tự các bước. */
function applyStationRecords(records) {
  buildStations(records);
  renderActiveLayer();
  isDataReady = true;
  updateLayerUI();
}

async function loadData() {
  try {
    isDataReady = false;
    setLoadingIndicator(true);
    clearSearchState();
    removeAllStationsFromMap();

    const records = await fetchStationRecords();
    saveStationCache(records);
    applyStationRecords(records);

    // Sheet đọc được nhưng không có trạm nào (bị lọc/xóa dữ liệu/đổi cách đánh
    // dấu cột công nghệ) — nếu im lặng thì bản đồ trống trơn trông y hệt lúc
    // đang tải, người dùng không biết vì sao.
    if (!records.length) {
      showToast(
        "Đọc được Google Sheet nhưng không có trạm 4G/5G nào.\n" +
        "Kiểm tra lại cột đánh dấu công nghệ (4G/5G) hoặc bộ lọc đang bật trên sheet.",
        { type: "warning", duration: 8000 }
      );
    }
  } catch (error) {
    console.error("Không tải được dữ liệu trạm:", error);

    const cached = readStationCache();
    if (!cached) {
      updateLayerUI();
      showToast(
        error.name === "TimeoutError"
          ? "Google Sheet (Danh sách trạm 5G/4G) không phản hồi. Kiểm tra kết nối mạng rồi tải lại trang."
          : "Không đọc được dữ liệu Google Sheet (Danh sách trạm 5G/4G).",
        { type: "danger", duration: 7000 }
      );
      return;
    }

    applyStationRecords(cached.records);

    const cachedTime = new Date(cached.savedAt).toLocaleString("vi-VN");
    showToast(
      `Không tải được dữ liệu mới nhất từ Google Sheet.\n` +
      `Đang hiển thị dữ liệu tạm lưu lúc ${cachedTime}, có thể chưa cập nhật mới nhất.`,
      { type: "warning", duration: 7000 }
    );
  } finally {
    setLoadingIndicator(false);
    hideInitialLoadOverlay();
  }
}

/* =====================================================
   9. TÌM KIẾM (ĐỊA CHỈ / TỌA ĐỘ / MÃ TRẠM / ĐỊNH VỊ)
   ===================================================== */

function normalizeAddressQuery(value) {
  return cleanText(value)
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ");
}

function ensureVietnamSuffix(value) {
  const cleaned = normalizeAddressQuery(value);
  if (!cleaned) return "";

  const normalized = normalizeText(cleaned);
  if (normalized.includes("viet nam") || normalized.includes("vietnam")) {
    return cleaned;
  }

  return `${cleaned}, Việt Nam`;
}

/* Bỏ SỐ NHÀ ở đầu địa chỉ để thử lại khi Nominatim không tìm thấy địa chỉ chi
   tiết (dữ liệu OSM ở VN thường chỉ có tới cấp đường/phường).

   Mẫu bắt buộc phải BẮT ĐẦU BẰNG CHỮ SỐ (\d): "123", "12A", "12/3", "45-47".
   Trước đây mẫu là [0-9a-zA-Z]+ — không đòi hỏi chữ số nào — nên với địa chỉ
   gõ KHÔNG DẤU (rất phổ biến), nó nuốt luôn từ đầu của tên đường: "Le Duan"
   -> "Duan", "Nguyen Van Cu" -> "Cu", khiến lượt thử dự phòng đi tìm một địa
   chỉ khác hẳn thay vì mở rộng phạm vi. (Địa chỉ GÕ CÓ DẤU tình cờ không dính
   lỗi vì ký tự có dấu không nằm trong lớp ký tự, nên lỗi rất dễ bị bỏ sót.) */
function simplifyAddressQuery(value) {
  const cleaned = normalizeAddressQuery(value);
  if (!cleaned) return "";

  const parts = cleaned.split(",").map(part => part.trim()).filter(Boolean);
  if (!parts.length) return "";

  const simplifiedFirstPart = parts[0]
    .replace(/^(so|số)\s+/i, "")
    .replace(/^\d[0-9a-zA-Z]*(?:[/-][0-9a-zA-Z]+)*\s+/, "")
    .trim();

  if (simplifiedFirstPart) {
    parts[0] = simplifiedFirstPart;
  }

  return parts.join(", ");
}

function buildNominatimUrl(query, { limit, bounded }) {
  const params = new URLSearchParams({
    format: "json",
    limit: String(limit),
    countrycodes: "vn",
    addressdetails: "1",
    q: query
  });

  // stationSearchBounds được tính 1 lần lúc dựng trạm (xem buildStations) —
  // trước đây quét lại toàn bộ >1500 trạm ở MỖI request geocode, kể cả các
  // request phát sinh theo từng phím gõ.
  if (bounded && stationSearchBounds) {
    const { left, top, right, bottom } = stationSearchBounds;
    params.set("viewbox", `${left},${top},${right},${bottom}`);
    params.set("bounded", "1");
  }

  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/* Các lượt thử tìm địa chỉ, theo thứ tự từ chặt tới lỏng: đúng nguyên văn
   (giới hạn trong vùng có trạm -> toàn quốc), rồi tới bản rút gọn bỏ số nhà. */
function buildAddressSearchPlan(rawQuery) {
  const exact = normalizeAddressQuery(rawQuery);
  const simplified = simplifyAddressQuery(exact);
  const plan = [];

  const addAttempt = (query, bounded) => {
    const finalQuery = ensureVietnamSuffix(query);
    if (!finalQuery) return;
    if (plan.some(item => item.query === finalQuery && item.bounded === bounded)) return;
    plan.push({ query: finalQuery, bounded });
  };

  addAttempt(exact, true);
  addAttempt(exact, false);

  if (simplified && normalizeText(simplified) !== normalizeText(exact)) {
    addAttempt(simplified, true);
    addAttempt(simplified, false);
  }

  return plan;
}

/* --- NHỊP GỌI NOMINATIM ------------------------------------------------------
   Nominatim công cộng của OpenStreetMap giới hạn TUYỆT ĐỐI 1 request/giây cho
   mỗi ứng dụng; vượt ngưỡng thì bị chặn theo ĐỊA CHỈ IP. Ở đây điều đó không
   phải rủi ro lý thuyết: 1 lượt tìm địa chỉ "đầy đủ" bắn tới 4 lượt thử nối
   tiếp nhau không nghỉ (buildAddressSearchPlan: nguyên văn có/không giới hạn
   vùng, rồi bản rút gọn bỏ số nhà có/không giới hạn vùng — đã đo đúng 4
   request), cộng thêm 1 request cho mỗi lần ngừng gõ ở ô gợi ý. Cả phòng kinh
   doanh thường ngồi sau CÙNG 1 IP NAT, nên 1 người bị chặn là cả phòng mất
   luôn tính năng tìm theo địa chỉ.

   Mọi lời gọi Nominatim vì vậy phải xếp hàng qua đây: chạy tuần tự và cách
   nhau tối thiểu NOMINATIM_MIN_INTERVAL_MS. Lượt gọi đã bị hủy (người dùng gõ
   tiếp ký tự mới) được bỏ qua NGAY và KHÔNG chiếm suất — nếu không, gõ nhanh
   sẽ đẩy các request còn sống ra sau hàng dài vô ích. */
const NOMINATIM_MIN_INTERVAL_MS = 1100;

let nominatimQueue = Promise.resolve();
let nominatimLastRequestAt = 0;

function scheduleNominatimRequest(run, signal) {
  const abortedError = () => new DOMException("Đã hủy tra cứu địa chỉ", "AbortError");

  const result = nominatimQueue.then(async () => {
    if (signal?.aborted) throw abortedError();

    const waitMs = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - nominatimLastRequestAt);
    if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));

    // Kiểm tra lại sau khi chờ: trong lúc xếp hàng người dùng có thể đã gõ tiếp
    if (signal?.aborted) throw abortedError();

    nominatimLastRequestAt = Date.now();
    return run();
  });

  // Hàng đợi KHÔNG được đứt vì 1 lượt lỗi/bị hủy — nuốt lỗi ở nhánh nối tiếp,
  // lỗi thật vẫn tới tay bên gọi qua `result`.
  nominatimQueue = result.catch(() => {});
  return result;
}

/* Geocode địa chỉ qua Nominatim. `quick` = chỉ thử lượt đầu tiên (dùng cho
   gợi ý theo từng phím gõ, cần nhanh và ít gọi API); mặc định thử toàn bộ
   kế hoạch (dùng khi người dùng bấm nút tìm kiếm, cần ra kết quả bằng được). */
async function geocodeAddress(rawQuery, { limit = 5, quick = false, signal } = {}) {
  const plan = buildAddressSearchPlan(rawQuery);
  const attempts = quick ? plan.slice(0, 1) : plan;

  for (const attempt of attempts) {
    const body = await scheduleNominatimRequest(
      () => fetchTextWithTimeout(
        buildNominatimUrl(attempt.query, { limit, bounded: attempt.bounded }),
        { label: "Nominatim", signal }
      ),
      signal
    );

    const data = JSON.parse(body);
    if (Array.isArray(data) && data.length) {
      return data;
    }
  }

  return [];
}

/* Tìm & gợi ý các trạm gần 1 vị trí:
   - Đặt lại toàn bộ dấu vết tìm kiếm cũ
   - Chọn CONFIG.MAX_SUGGESTED_POINTS trạm gần nhất TRONG LỚP ĐANG HIỂN THỊ
   - Cảnh báo (không chặn) nếu vị trí nằm ngoài mọi vòng tròn
   - Highlight trạm, vẽ đường nối kèm khoảng cách, bổ sung khối khoảng cách
     vào popup của các trạm được gợi ý

   `accuracyM` (định vị GPS) vẽ vòng tròn sai số quanh vị trí — CỐ Ý nhận qua
   tham số thay vì để locateMe() tự vẽ sau khi gọi hàm này: hàm này có thể
   thoát sớm (dữ liệu chưa tải xong) mà không chạy clearSearchState(), nên
   vòng tròn vẽ bên ngoài sẽ đè lên biến accuracyCircle cũ và bỏ lại 1 layer
   không còn ai tham chiếu tới trên bản đồ (không cách nào xoá được nữa). */
function findNearestStations(lat, lng, { originPopupHtml = "", accuracyM = null } = {}) {
  if (!isDataReady) {
    showToast(`Dữ liệu trạm ${activeTech} đang tải, vui lòng thử lại sau.`, { type: "warning" });
    return;
  }

  clearSearchState();

  searchOrigin = { lat, lng };
  searchOriginMarker = L.marker([lat, lng]).addTo(map);
  if (originPopupHtml) {
    searchOriginMarker.bindPopup(originPopupHtml);
  }
  if (Number.isFinite(accuracyM) && accuracyM > 0) {
    accuracyCircle = L.circle([lat, lng], {
      pane: SEARCH_OVERLAY_PANE,
      radius: accuracyM,
      color: "blue",
      fillColor: "blue",
      fillOpacity: 0.1
    }).addTo(map);
  }

  map.setView([lat, lng], 15);

  const stations = getActiveStations();
  const ranked = stations
    .map(station => ({ station, distance: haversine(lat, lng, station.lat, station.lng) }))
    .sort((a, b) => a.distance - b.distance);

  // Cảnh báo "ngoài vùng phủ" xét trên TOÀN BỘ trạm của lớp, không chỉ vài
  // trạm được gợi ý: 1 trạm xa hơn nhưng bán kính lớn vẫn có thể phủ tới nơi.
  const insideAny = ranked.some(candidate => candidate.distance <= candidate.station.radius);
  const candidates = ranked.slice(0, CONFIG.MAX_SUGGESTED_POINTS);

  candidates.forEach((candidate, index) => {
    const station = candidate.station;
    const isInside = candidate.distance <= station.radius;

    setStationHighlight(station, true);

    const coverageBadge = isInside
      ? '<span class="badge badge-success">Trong vùng phủ ước tính</span>'
      : `<span class="badge badge-warning">Ngoài vùng phủ (xa hơn ${Math.round(station.radius)} m)</span>`;
    const bestBadge = index === 0
      ? '<span class="badge badge-primary">Gợi ý gần nhất</span>'
      : "";

    station.extraHtml = `
      <div class="popup-divider"></div>
      <dl class="popup-meta popup-extra">
        <div class="popup-meta-row">
          <dt>Khoảng cách</dt>
          <dd class="popup-strong">${Math.round(candidate.distance)} m</dd>
        </div>
      </dl>
      <div class="popup-badges">${bestBadge}${coverageBadge}</div>
    `;

    const line = L.polyline(
      [[lat, lng], [station.lat, station.lng]],
      { pane: SEARCH_OVERLAY_PANE, color: index === 0 ? "red" : "green", dashArray: "5,5" }
    ).addTo(map);
    line.bindTooltip(`${Math.round(candidate.distance)} m`, { permanent: true, direction: "center" });
    suggestionLayers.push(line);
  });

  // Sau khi đã đánh dấu highlight: vẽ lại tập trạm hiển thị quanh vị trí vừa
  // tìm (các trạm được gợi ý luôn nằm trong tập này, kể cả khi ở ngoài khung
  // nhìn) — getBounds() đã phản ánh view mới ngay sau setView ở trên.
  updateVisibleStations();
  // "Số trạm đang hiển thị" tính cả trạm highlighted (xem
  // getFilteredActiveStations) — cập nhật lại ngay phòng khi 1 trong các trạm
  // gợi ý có mức tải đang bị checkbox lọc PRB ẩn.
  updateLayerUI();

  // Đặt TRƯỚC phần cảnh báo để CẢ nhánh "không có trạm nào" cũng được xử lý
  // giống nhau (trước đây nhánh đó thoát sớm, để lại panel che kín bản đồ trên
  // di động và marker vị trí không mở được popup).
  if (originPopupHtml) {
    prepareLayerPopup(searchOriginMarker);
    searchOriginMarker.openPopup();
  } else {
    collapseControlBoxOnMobile();
  }

  if (!candidates.length) {
    showToast(`Chưa có dữ liệu trạm ${activeTech} để gợi ý.`, { type: "warning" });
    return;
  }

  if (!insideAny) {
    showToast(
      activeTech === "5G"
        ? "Vị trí này nằm ngoài vùng phủ 5G ước tính của mọi trạm xung quanh.\n" +
          `Vẫn hiển thị ${candidates.length} trạm gần nhất để tham khảo, tốc độ thực tế tại vị trí này có thể không đạt cam kết.`
        : "Vị trí này nằm ngoài bán kính an toàn 4G của mọi trạm xung quanh.\n" +
          `Vẫn hiển thị ${candidates.length} trạm 4G gần nhất kèm mức tải PRB để tham khảo, tốc độ thực tế tại vị trí này có thể không đạt.`,
      { type: "warning", duration: 8000 }
    );
  }
}

/* Chặn nhiều lượt tìm địa chỉ chạy chồng nhau (bấm Enter liên tục): mỗi lượt
   đều xóa trạng thái cũ rồi dời bản đồ, chạy song song sẽ nhấp nháy và kết quả
   cuối phụ thuộc thứ tự phản hồi mạng. Nút kính lúp đã bị vô hiệu hóa trong
   lúc chờ, nhưng phím Enter thì không đi qua nút đó. */
let isSearchingLocation = false;

/* Tìm theo ô nhập: chấp nhận "lat, lng" hoặc địa chỉ tự do */
async function searchLocation() {
  if (!isDataReady) {
    showToast(`Dữ liệu trạm ${activeTech} đang tải, vui lòng thử lại sau.`, { type: "warning" });
    return;
  }
  if (isSearchingLocation) return;

  const value = dom.searchInput.value.trim();
  if (!value) return;

  hideSuggestBoxes();

  // Nhập tọa độ trực tiếp
  const parts = value.split(",");
  if (parts.length === 2 && parts.every(part => part.trim() !== "" && !Number.isNaN(Number(part)))) {
    if (!validateLatLng(parts[0], parts[1])) {
      showToast("Tọa độ không hợp lệ. Vui lòng kiểm tra lại giá trị đã nhập.", { type: "warning" });
      return;
    }
    findNearestStations(Number(parts[0]), Number(parts[1]));
    return;
  }

  isSearchingLocation = true;
  dom.searchBtn.disabled = true;
  try {
    const results = await geocodeAddress(value, { limit: 1 });
    if (!results.length) {
      showToast("Không tìm thấy địa chỉ cần tìm.", { type: "warning" });
      return;
    }

    findNearestStations(Number(results[0].lat), Number(results[0].lon));
  } catch (error) {
    console.error("Lỗi tìm địa chỉ:", error);
    showToast(
      error.name === "TimeoutError"
        ? "Máy chủ tra cứu địa chỉ không phản hồi. Vui lòng thử lại."
        : "Không tìm được địa chỉ. Vui lòng kiểm tra kết nối mạng.",
      { type: "danger" }
    );
  } finally {
    isSearchingLocation = false;
    dom.searchBtn.disabled = false;
  }
}

/* Định vị người dùng bằng GPS trình duyệt */
function locateMe() {
  if (!navigator.geolocation) {
    showToast("Trình duyệt không hỗ trợ định vị.", { type: "danger" });
    return;
  }

  dom.locateBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    position => {
      dom.locateBtn.disabled = false;

      const { latitude, longitude, accuracy } = position.coords;

      // Marker vị trí VÀ vòng tròn sai số đều do findNearestStations tạo — nó
      // là nơi duy nhất quản lý vòng đời dấu vết của 1 lượt tìm kiếm (trước
      // đây locateMe tự tạo thêm marker -> 2 marker chồng khít nhau; rồi tự vẽ
      // vòng tròn sai số bên ngoài -> rò rỉ layer khi dữ liệu chưa tải xong).
      findNearestStations(latitude, longitude, {
        originPopupHtml: '<div class="popup-simple"><i data-lucide="map-pin"></i>Vị trí của tôi</div>',
        accuracyM: accuracy
      });
    },
    error => {
      dom.locateBtn.disabled = false;
      showToast(`Không lấy được vị trí: ${error.message}`, { type: "danger" });
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

/* --- GỢI Ý (AUTOCOMPLETE) ---------------------------------------------------

   Mỗi ô tìm kiếm có MỘT đối tượng duy nhất quản lý trọn vòng đời hộp gợi ý:
   dựng danh sách, ẩn/hiện, mục đang chọn bằng bàn phím và thuộc tính ARIA.
   Trước đây phần này nằm rải rác (hàm render dùng chung + hẹn giờ + biến đếm
   request ở ngoài + 4 chỗ tự tay gán style.display = "none") và sinh ra 2 lỗi
   thật, đều đã tái hiện được:
     1. Xóa bớt ký tự cho query ngắn lại (<3 ký tự) chỉ ẩn hộp mà KHÔNG hủy
        request đang bay, nên gợi ý của query cũ vẫn bật hộp lên lại sau đó.
     2. Bấm Enter để tìm ngay: hộp gợi ý bị ẩn, rồi hẹn giờ 300ms của lần gõ
        cuối cùng vẫn nổ và mở lại hộp đè lên kết quả vừa tìm.
   Hộp gợi ý còn khai báo role="listbox"/"option" nhưng trước đó KHÔNG dùng
   được bằng bàn phím (chỉ chuột/chạm) — nay có ↑ ↓ Enter Esc và
   aria-activedescendant đúng chuẩn combobox. */
function createSuggestBox({ input, box, renderItem, onSelect, emptyMessage, selectFirstOnEnter = false, cancelPending }) {
  let items = [];
  // Phần tử role="option" tương ứng items — theo dõi riêng thay vì đọc
  // box.children: hộp còn có thể chứa dòng thông báo "không tìm thấy"
  // (.suggest-empty) vốn KHÔNG phải option, gán aria-selected lên đó là sai.
  let optionElements = [];
  let activeIndex = -1;

  const optionId = index => `${box.id}-option-${index}`;

  function setActiveIndex(index) {
    activeIndex = index;
    optionElements.forEach((option, i) => {
      const isActive = i === index;
      option.classList.toggle("active", isActive);
      option.setAttribute("aria-selected", String(isActive));
    });

    if (index >= 0) {
      input.setAttribute("aria-activedescendant", optionId(index));
      optionElements[index].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function hide() {
    // Đóng hộp là hủy LUÔN mọi việc đang chờ của nó (hẹn giờ gõ phím + request
    // đang bay). Nếu để bên ngoài tự nhớ gọi, sẽ có đường đi bị sót — thực tế
    // đã sót đúng đường "bấm chuột chọn 1 dòng gợi ý": chỉ hide() mà không hủy,
    // nên nếu người dùng vừa gõ thêm 1 ký tự rồi bấm ngay vào dòng cũ (dưới
    // 300ms), hẹn giờ của ký tự đó vẫn nổ sau đó và mở lại hộp đè lên kết quả
    // vừa chọn.
    if (cancelPending) cancelPending();

    box.style.display = "none";
    box.replaceChildren();
    items = [];
    optionElements = [];
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function show(nextItems) {
    // Đã gõ đủ ký tự và có chạy tìm, nhưng không khớp gì — báo rõ thay vì
    // lặng lẽ đóng hộp (trước đây rơi thẳng vào hide(), người dùng không biết
    // là "chưa tìm" hay "tìm rồi nhưng không có kết quả"). Không áp dụng khi
    // nơi gọi không truyền emptyMessage (VD ô đã bị xóa hết ký tự — nơi gọi tự
    // gọi hide() thẳng cho trường hợp đó, không đi qua show([])).
    if (!nextItems.length) {
      if (!emptyMessage) {
        hide();
        return;
      }
      items = [];
      optionElements = [];
      box.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "suggest-empty";
      empty.textContent = emptyMessage;
      box.appendChild(empty);
      box.style.display = "block";
      input.setAttribute("aria-expanded", "true");
      setActiveIndex(-1);
      return;
    }

    items = nextItems;
    box.replaceChildren();

    optionElements = items.map((item, index) => {
      const option = document.createElement("div");
      option.className = "suggest-item";
      option.id = optionId(index);
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      renderItem(option, item);
      option.addEventListener("click", () => select(item));
      box.appendChild(option);
      return option;
    });

    box.style.display = "block";
    input.setAttribute("aria-expanded", "true");
    setActiveIndex(-1);
    // Icon chèn động (VD ghim địa chỉ trong renderItem) cần lượt quét lucide
    // riêng — trang chỉ tự chuyển <i data-lucide> -> SVG 1 lần lúc khởi động.
    refreshIcons();
  }

  function select(item) {
    hide();
    onSelect(item);
  }

  /* Trả về true nếu phím đã được xử lý ở đây — nơi gọi (bindEvents) dựa vào đó
     để không chạy tiếp hành động mặc định của ô nhập (VD Enter = tìm ngay). */
  function handleKeydown(event) {
    if (event.key === "Escape") {
      hide();
      return true;
    }
    if (!items.length) return false;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((activeIndex + 1) % items.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
      return true;
    }
    if (event.key === "Enter") {
      // Chưa chọn dòng nào: ô nào KHÔNG có hành động tìm kiếm riêng (ô mã trạm)
      // thì Enter chọn luôn kết quả đầu — nếu không, Enter sẽ không làm gì cả
      // và người dùng tưởng ô bị treo. Ô địa chỉ thì ngược lại: Enter phải chạy
      // geocode nội dung vừa gõ (có thể là địa chỉ không nằm trong gợi ý).
      const index = activeIndex >= 0 ? activeIndex : (selectFirstOnEnter ? 0 : -1);
      if (index < 0) return false;
      event.preventDefault();
      select(items[index]);
      return true;
    }
    return false;
  }

  return { show, hide, handleKeydown };
}

/* --- Gợi ý địa chỉ (Nominatim) --- */

const ADDRESS_SUGGEST_DEBOUNCE_MS = 300;
const ADDRESS_SUGGEST_MIN_CHARS = 3;

const addressSuggest = createSuggestBox({
  input: dom.searchInput,
  box: dom.suggestBox,
  renderItem: (option, item) => {
    const row = document.createElement("div");
    row.className = "suggest-item-row";
    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", "map-pin");
    icon.className = "suggest-item-row-icon";
    const text = document.createElement("span");
    text.className = "suggest-item-row-text";
    text.textContent = item.display_name;
    row.append(icon, text);
    option.append(row);
  },
  emptyMessage: "Không tìm thấy địa chỉ phù hợp",
  cancelPending: () => cancelAddressSuggest(),
  onSelect: item => {
    dom.searchInput.value = item.display_name;
    findNearestStations(Number(item.lat), Number(item.lon));
  }
});

let addressSuggestTimer = null;
let addressSuggestController = null;

/* Hủy mọi việc đang chờ của gợi ý địa chỉ (hẹn giờ gõ phím + request đang bay),
   nếu không kết quả của truy vấn cũ sẽ quay lại đè lên trạng thái mới.
   Được gắn làm `cancelPending` của hộp gợi ý nên MỌI lần hộp đóng đều tự chạy;
   ở đây chỉ còn phải gọi thêm ở đầu mỗi lần gõ. Hàm an toàn khi gọi lặp. */
function cancelAddressSuggest() {
  clearTimeout(addressSuggestTimer);
  addressSuggestTimer = null;

  if (addressSuggestController) {
    addressSuggestController.abort();
    addressSuggestController = null;
  }
}

function handleAddressInput() {
  cancelAddressSuggest();

  const query = dom.searchInput.value.trim();
  if (query.length < ADDRESS_SUGGEST_MIN_CHARS) {
    addressSuggest.hide();
    return;
  }

  addressSuggestTimer = setTimeout(async () => {
    const controller = new AbortController();
    addressSuggestController = controller;

    try {
      const results = await geocodeAddress(query, { limit: 5, quick: true, signal: controller.signal });
      addressSuggest.show(results);
    } catch (error) {
      if (isAbortError(error)) return; // người dùng đã gõ tiếp / đã đóng hộp
      console.error("Lỗi gợi ý địa chỉ:", error);
      addressSuggest.hide();
    } finally {
      if (addressSuggestController === controller) addressSuggestController = null;
    }
  }, ADDRESS_SUGGEST_DEBOUNCE_MS);
}

/* --- Gợi ý mã trạm / địa chỉ trạm (dữ liệu sẵn trong bộ nhớ) --- */

const MAX_STATION_SUGGESTIONS = 10;

/* Mức độ khớp, càng nhỏ càng ưu tiên. Trước đây danh sách chỉ lấy 10 kết quả
   ĐẦU TIÊN quét được và luôn quét hết lớp 5G trước, nên một truy vấn khớp
   nhiều địa chỉ 5G sẽ chiếm sạch danh sách và trạm 4G KHÔNG BAO GIỜ hiện ra —
   kể cả khi người dùng đang gõ gần đúng mã của một trạm 4G. */
function rankStationMatch(station, query) {
  if (station.siteKey.startsWith(query)) return 0;
  if (station.siteKey.includes(query)) return 1;
  if (station.addressKey.includes(query)) return 2;
  return -1;
}

function findStationMatches(query) {
  const matches = [];

  TECHS.forEach((tech, techOrder) => {
    let seq = 0;
    for (const station of stationsByTech[tech]) {
      const rank = rankStationMatch(station, query);
      if (rank >= 0) matches.push({ station, rank, seq: seq++, techOrder });
    }
  });

  // Trong CÙNG một mức khớp thì XEN KẼ 2 lớp (5G thứ nhất, 4G thứ nhất, 5G thứ
  // hai, 4G thứ hai...). Chỉ xếp theo mức khớp là chưa đủ: một từ khóa khớp
  // hàng trăm ĐỊA CHỈ (cùng mức 2) vẫn sẽ lấy hết 10 chỗ cho lớp được quét
  // trước — đúng cái lỗi cần sửa. Xen kẽ bảo đảm cả 2 lớp luôn có mặt, đồng
  // thời trạm có cả 4G lẫn 5G vẫn hiện thành 2 dòng liền nhau khi gõ đúng mã.
  matches.sort((a, b) => a.rank - b.rank || a.seq - b.seq || a.techOrder - b.techOrder);
  return matches.slice(0, MAX_STATION_SUGGESTIONS).map(match => match.station);
}

const stationSuggest = createSuggestBox({
  input: dom.stationInput,
  box: dom.stationSuggestBox,
  renderItem: (option, station) => {
    const head = document.createElement("div");
    head.className = "suggest-item-head";
    const badge = document.createElement("span");
    badge.className = "badge-tech";
    badge.textContent = station.tech;
    const siteId = document.createElement("strong");
    siteId.textContent = station.siteId;
    head.append(badge, siteId);

    const address = document.createElement("div");
    address.className = "suggest-item-address";
    address.textContent = station.address;

    option.append(head, address);
  },
  emptyMessage: "Không tìm thấy trạm phù hợp",
  selectFirstOnEnter: true,
  onSelect: station => {
    dom.stationInput.value = station.siteId;

    // switchActiveTech() tự gọi clearSearchState() (+ resetPrbBandFilter())
    // khi có đổi lớp; nếu KHÔNG đổi lớp thì phải tự gọi ở đây — dọn highlight/
    // đường nối của lượt tìm kiếm trước, tránh chồng thêm trạm nhấp nháy mới
    // lên các trạm cũ vẫn còn đang nhấp nháy từ lượt trước.
    if (station.tech !== activeTech) switchActiveTech(station.tech);
    else clearSearchState();

    map.setView([station.lat, station.lng], 16);
    updateVisibleStations();
    // openPopup() chỉ hoạt động khi layer đã có trên map — đảm bảo trạm vừa
    // chọn có mặt dù viewport culling có kịp xử lý hay chưa (setView có thể
    // đang chạy animation).
    addStationToMap(station);
    // Đánh dấu highlighted: giữ trạm này LUÔN hiện trên map ở mọi lần
    // updateVisibleStations() sau (VD moveend khi animation pan của setView()
    // ở trên hoàn tất), bất kể nằm ngoài khung nhìn hay mức tải của nó đang bị
    // checkbox lọc PRB ẩn — nếu không, trạm vừa chọn (kèm popup đang mở) có
    // thể biến mất gần như ngay lập tức.
    setStationHighlight(station, true);
    // "Số trạm đang hiển thị" tính cả trạm highlighted (xem
    // getFilteredActiveStations) — cập nhật lại ngay để không lệch so với
    // trạm vừa được ép hiện lên map, phòng khi mức tải của nó đang bị ẩn.
    updateLayerUI();
    // Thu gọn panel (di động) + tính đệm autoPan TRƯỚC khi mở popup
    prepareLayerPopup(station.circle);
    station.circle.openPopup();
  }
});

/* Tìm nhanh theo mã trạm (Site_ID) hoặc địa chỉ — quét CẢ 2 lớp cùng lúc (đã
   có sẵn trong bộ nhớ, không cần gọi API). Chọn 1 kết quả thuộc lớp đang TẮT
   sẽ tự động chuyển segmented switch sang lớp đó. */
function handleStationInput() {
  const query = normalizeText(dom.stationInput.value);
  if (!query) {
    stationSuggest.hide();
    return;
  }

  stationSuggest.show(findStationMatches(query));
}

/* Đóng cả 2 hộp gợi ý (mỗi hộp tự hủy việc đang chờ của nó trong hide()) */
function hideSuggestBoxes() {
  addressSuggest.hide();
  stationSuggest.hide();
}

/* =====================================================
   10. XUẤT KML
   ===================================================== */

/* Xuất trạm của lớp đang hiển thị ra file KML (chuyển circle Leaflet thành
   polygon để tương thích Google Earth) — chỉ xuất đúng các mức tải PRB đang
   được tick (getFilteredActiveStations), khớp với "Số trạm đang hiển thị" và
   những gì thực sự đang vẽ trên bản đồ. 08/2026: mô tả giống hệt nhau cho cả
   2 lớp (trước đây 4G có thêm dòng % PRB, 5G không có). */
function exportActiveLayerToKml() {
  // .slice() trước khi sắp xếp — getFilteredActiveStations() trả về mảng lọc
  // từ stationsByTech, không được đảo thứ tự tại chỗ (mảng gốc còn dùng lại
  // cho lượt vẽ map/đếm trạm kế tiếp). Sắp theo KML_DRAW_ORDER để "Tải cao"
  // luôn vẽ sau cùng (đè lên trên) khi các vòng tròn chồng lấn.
  const stations = getFilteredActiveStations()
    .slice()
    .sort((a, b) => KML_DRAW_ORDER.indexOf(a.prbBandKey) - KML_DRAW_ORDER.indexOf(b.prbBandKey));
  if (!isDataReady || !stations.length) {
    showToast(`Dữ liệu trạm ${activeTech} chưa tải xong hoặc không có trạm nào (kiểm tra lại bộ lọc mức tải PRB). Vui lòng thử lại sau.`, { type: "warning" });
    return;
  }

  const placemarks = stations.map(station => {
    const extraDescLine = `Mức tải PRB: ${Number.isFinite(station.prb) ? station.prb.toFixed(1) + "%" : "chưa có dữ liệu"}<br>
        Bán kính phủ: ${Math.round(station.radius)} m`;

    return `
      <Placemark>
        <name>${escapeXml(station.siteId)}</name>
        <description><![CDATA[
          <b>Trạm ${escapeHtml(station.siteId)}</b><br>
          Địa chỉ: ${escapeHtml(station.address)}<br>
          Độ cao anten: ${station.height.toFixed(1)} m<br>
          ${extraDescLine}
        ]]></description>
        <Style>
          <PolyStyle>
            <color>${hexToKmlColor(station.color, KML_FILL_ALPHA_HEX)}</color>
            <outline>1</outline>
          </PolyStyle>
          <LineStyle>
            <color>${hexToKmlColor(station.color, KML_OUTLINE_ALPHA_HEX)}</color>
            <width>${KML_OUTLINE_WIDTH_PX}</width>
          </LineStyle>
        </Style>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>
                ${circleToPolygon(station.lat, station.lng, station.radius)}
              </coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
    `;
  }).join("");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>Vùng phủ ${activeTech} FWA</name>
  ${placemarks}
</Document>
</kml>`;

  downloadFile(kml, `Vung_phu_${activeTech}_FWA.kml`, "application/vnd.google-earth.kml+xml");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  // Phải gắn thẻ <a> vào DOM trước khi click và chỉ thu hồi URL SAU khi trình
  // duyệt đã bắt đầu tải — thu hồi ngay lập tức làm hỏng file tải về trên một
  // số trình duyệt (Firefox).
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/* =====================================================
   11. PANEL / LEGEND & KHỞI ĐỘNG
   ===================================================== */

function setControlBoxCollapsed(collapsed) {
  dom.controlBox.classList.toggle("collapsed", collapsed);
  dom.controlToggle.setAttribute("aria-expanded", String(!collapsed));
  dom.controlToggle.setAttribute("aria-label", collapsed ? "Mở rộng bảng điều khiển" : "Thu gọn bảng điều khiển");
}

function toggleControlBox() {
  setControlBoxCollapsed(!dom.controlBox.classList.contains("collapsed"));
}

function collapseControlBox() {
  setControlBoxCollapsed(true);
}

/* Trên di động, bảng điều khiển khi đang MỞ che gần nửa trên bản đồ — chừa
   chỗ cho nó bằng đệm autoPan (computePopupAutoPanPadding) là không đủ vì đệm
   sẽ ăn gần hết khung nhìn, nên ở đây thu gọn hẳn panel trước khi mở popup
   (đã xác minh bằng ảnh chụp thực tế trên viewport 390x844).
   Trên desktop panel chỉ là sidebar hẹp nên KHÔNG thu gọn — popup tự né sang
   vùng trống nhờ đệm autoPan, người dùng giữ nguyên ô tìm kiếm vừa dùng.
   Xem thêm chú thích thứ tự gọi trong prepareLayerPopup(). */
function collapseControlBoxOnMobile() {
  if (isMobileViewport()) collapseControlBox();
}

function setLegendCollapsed(collapsed) {
  dom.legendBox.classList.toggle("collapsed", collapsed);
  dom.legendToggle.setAttribute("aria-expanded", String(!collapsed));
}

function toggleLegend() {
  setLegendCollapsed(!dom.legendBox.classList.contains("collapsed"));
}

/* Khối lọc theo mức tải PRB — MẶC ĐỊNH ĐÓNG (trạng thái ban đầu khai báo ngay
   ở markup index.html, giống .control-box/.legend). 5 dòng checkbox chiếm
   ~205px trên di động / ~110px trên desktop trong khi phần lớn lượt dùng chỉ
   cần xem bản đồ; đóng sẵn nhường chỗ đó cho bản đồ. Trạng thái đóng/mở KHÔNG
   bị reset khi đổi lớp 5G/4G (chỉ các checkbox bên trong mới reset — xem
   resetPrbBandFilter): đóng/mở là thói quen xem của người dùng, không phải dữ
   liệu của lớp. Người dùng vẫn biết mình đang lọc dở nhờ badge trên tiêu đề
   (updateLayerUI). */
function setPrbFilterCollapsed(collapsed) {
  dom.prbFilter.classList.toggle("collapsed", collapsed);
  dom.prbFilterToggle.setAttribute("aria-expanded", String(!collapsed));
}

function togglePrbFilter() {
  setPrbFilterCollapsed(!dom.prbFilter.classList.contains("collapsed"));
}

/* Thống kê lượt truy cập (Google Apps Script) — không ảnh hưởng chức năng,
   lỗi thì bỏ qua im lặng để không làm nhiễu console của người dùng. */
function reportPageView() {
  if (!CONFIG.TRACKING_SCRIPT_URL) return;

  // Không dùng fetchTextWithTimeout được: phản hồi mode "no-cors" là phản hồi
  // mờ (status luôn 0) nên mọi kiểm tra response.ok đều trượt. Vẫn đặt hạn giờ
  // để request thống kê không giữ kết nối vô hạn khi mạng chập chờn.
  //
  // Bọc try/catch vì AbortSignal.timeout() chỉ có từ Safari 16 / iOS 16 —
  // trên máy cũ hơn nó là undefined và NÉM NGAY khi dựng tham số, tức là ném
  // ra ngoài init() (đây là lời gọi cuối cùng) thành lỗi đỏ trong console.
  // Một con số thống kê không đáng để làm bẩn console của người dùng, càng
  // không đáng để trông như app bị lỗi.
  try {
    fetch(
      `${CONFIG.TRACKING_SCRIPT_URL}?url=${encodeURIComponent(window.location.href)}&v=1`,
      { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }
    ).catch(() => {});
  } catch (error) {
    console.warn("Bỏ qua thống kê lượt truy cập:", error);
  }
}

function bindEvents() {
  dom.controlToggle.addEventListener("click", toggleControlBox);
  dom.legendToggle.addEventListener("click", toggleLegend);
  dom.prbFilterToggle.addEventListener("click", togglePrbFilter);
  dom.locateBtn.addEventListener("click", locateMe);
  dom.searchBtn.addEventListener("click", searchLocation);
  dom.exportKmlBtn.addEventListener("click", exportActiveLayerToKml);

  dom.techSwitchButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => switchActiveTech(btn.dataset.tech));

    // Phím mũi tên đổi lớp — phần còn thiếu của chuẩn radiogroup (xem
    // roving tabindex trong updateLayerUI).
    btn.addEventListener("keydown", event => {
      const step = ARROW_KEY_STEP[event.key];
      if (!step) return;
      event.preventDefault();
      const buttons = dom.techSwitchButtons;
      const next = buttons[(index + step + buttons.length) % buttons.length];
      switchActiveTech(next.dataset.tech);
      next.focus();
    });
  });

  // Checkbox lọc theo mức tải PRB (áp dụng cho lớp đang chọn — cả 5G lẫn 4G)
  // — đổi 1 ô là vẽ lại ngay các trạm đang hiển thị + cập nhật số đếm/
  // breakdown, không cần tải lại dữ liệu (prbBandFilter chỉ quyết định VẼ hay
  // không, dữ liệu 2 lớp vẫn nguyên trong bộ nhớ). Đổi lớp 5G/4G thì trạng
  // thái này RESET (xem resetPrbBandFilter trong switchActiveTech).
  dom.prbFilterCheckboxes.forEach(checkbox => {
    const band = checkbox.dataset.prbBand;
    // Tên mức sai ở index.html chỉ tạo thêm 1 khóa thừa trong prbBandFilter:
    // checkbox trông như không làm gì cả, mức thật thì hiện mãi. Báo rõ ngay
    // lúc gắn sự kiện (cùng quy ước với renderLegend/data-prb-count).
    if (!(band in prbBandFilter)) {
      console.error(`Bộ lọc PRB: không có mức tải cho data-prb-band="${band}" — checkbox này sẽ không có tác dụng.`);
      return;
    }
    checkbox.addEventListener("change", () => {
      prbBandFilter[band] = checkbox.checked;
      updateVisibleStations();
      updateLayerUI();
    });
  });

  dom.searchInput.addEventListener("input", handleAddressInput);
  dom.stationInput.addEventListener("input", handleStationInput);

  // MỘT nơi xử lý phím cho mỗi ô nhập: hộp gợi ý được hỏi trước (↑ ↓ Enter khi
  // đang chọn 1 dòng, Esc để đóng); nếu nó không xử lý thì mới tới hành động
  // mặc định của ô. Nhờ vậy Enter không vừa chọn gợi ý vừa chạy tìm kiếm.
  dom.searchInput.addEventListener("keydown", event => {
    if (addressSuggest.handleKeydown(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      searchLocation(); // tự gọi hideSuggestBoxes() -> hủy luôn hẹn giờ gõ phím
    }
  });

  dom.stationInput.addEventListener("keydown", event => {
    stationSuggest.handleKeydown(event);
  });

  // Ẩn gợi ý khi bấm ra ngoài ô tìm kiếm
  document.addEventListener("click", event => {
    if (!event.target.closest(".search-row")) hideSuggestBoxes();
  });

  /* Double click trên bản đồ để chọn nhanh vị trí cần tìm trạm */
  map.on("dblclick", event => {
    const lat = event.latlng.lat.toFixed(6);
    const lng = event.latlng.lng.toFixed(6);
    // Gán .value bằng code KHÔNG kích hoạt sự kiện input, nên hộp gợi ý đang mở
    // (nếu có) sẽ giữ nguyên danh sách của lượt gõ cũ và hiện lại khi người dùng
    // mở lại panel — đóng nó ở đây cho khớp với nội dung ô vừa bị thay.
    hideSuggestBoxes();
    dom.searchInput.value = `${lat}, ${lng}`;
    findNearestStations(Number(lat), Number(lng));
  });

  // Nội dung popup được dựng động (không nằm trong lần quét icon ban đầu) —
  // quét lại icon mỗi khi 1 popup bất kỳ được mở.
  map.on("popupopen", refreshIcons);

  // Viewport culling: vẽ lại đúng tập trạm trong khung nhìn mỗi khi bản đồ
  // dừng pan/zoom (moveend cũng fire khi zoom nên không cần zoomend riêng).
  map.on("moveend", updateVisibleStations);
}

/* Chú giải bản đồ + bộ lọc lấy CẢ NGƯỠNG LẪN MÀU từ đúng nguồn mà bản đồ đang
   dùng (CONFIG + PRB_BANDS), không viết cứng trong index.html: sửa ngưỡng
   trong config.js hay đổi màu trong app.js thì chú giải tự khớp theo, không
   thể lệch với màu vòng tròn thật trên bản đồ. Ngưỡng/màu không đổi sau khi
   khởi tạo nên chỉ cần chạy 1 lần.

   index.html chỉ khai báo "chỗ này là mức nào / ngưỡng nào" bằng thuộc tính
   data-band-dot="<khóa mức>" và data-legend-threshold="<tên tham số CONFIG>" —
   trước đây là style="background:#..." cùng 6 id riêng cho 3 con số ngưỡng
   (vừa nhân đôi mã màu/giá trị, vừa buộc phải nới lỏng Content-Security-Policy
   cho style nội tuyến). Tên sai ở HTML được báo thẳng ra console thay vì hiện
   ô trống khó hiểu. */
function renderLegend() {
  for (const el of dom.legendThresholds) {
    const key = el.dataset.legendThreshold;
    if (key in CONFIG) el.textContent = CONFIG[key];
    else console.error(`Chú giải: không có tham số CONFIG cho data-legend-threshold="${key}".`);
  }

  for (const dot of dom.bandDots) {
    const band = PRB_BAND_BY_KEY[dot.dataset.bandDot];
    if (band) dot.style.background = band.color;
    else console.error(`Chú giải: không có mức tải cho data-band-dot="${dot.dataset.bandDot}".`);
  }
}

function init() {
  bindEvents();
  renderLegend();

  // Trên di động, mặc định thu gọn CẢ chú giải LẪN bảng điều khiển để nhường
  // phần lớn màn hình cho bản đồ ngay từ lần chạm đầu tiên (người dùng vẫn mở
  // lại bất kỳ lúc nào). Panel mở sẵn chiếm tới ~60% chiều cao màn hình điện
  // thoại (đo thực tế ở viewport 390x844).
  if (isMobileViewport()) {
    setLegendCollapsed(true);
    collapseControlBox();
  }

  // Đặt trạng thái UI ban đầu theo lớp mặc định — trước khi dữ liệu tải xong,
  // để giao diện không "trống" khó hiểu.
  updateLayerUI();
  refreshIcons();

  // loadData() tự xử lý mọi lỗi bên trong (rơi về cache / báo toast); .catch ở
  // đây chỉ là lưới an toàn cuối để không có promise lỗi bị bỏ rơi im lặng.
  loadData().catch(error => console.error("Lỗi ngoài dự kiến khi tải dữ liệu:", error));
  reportPageView();
}

init();
