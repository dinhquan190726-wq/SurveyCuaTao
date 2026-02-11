require('dotenv').config(); // Phải ở đầu tiên để load .env

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// CORS cho frontend test (production thay '*' bằng domain cụ thể)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

// DEBUG: In biến env để kiểm tra ngay khi chạy
console.log('=== DEBUG ENV VARIABLES ===');
console.log('SUPABASE_URL     :', process.env.SUPABASE_URL || 'KHÔNG CÓ / UNDEFINED');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'CÓ (ẩn giá trị)' : 'KHÔNG CÓ');
console.log('PORT             :', process.env.PORT || 'Mặc định 3000');
console.log('==========================');

// Kiểm tra biến env bắt buộc
if (!process.env.SUPABASE_URL) {
  console.error('LỖI NGHIÊM TRỌNG: SUPABASE_URL không tồn tại trong file .env');
  process.exit(1);
}
if (!process.env.SUPABASE_ANON_KEY) {
  console.error('LỖI NGHIÊM TRỌNG: SUPABASE_ANON_KEY không tồn tại trong file .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Middleware kiểm tra JWT từ frontend (nếu dùng protected route)
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Không có token' });

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: 'Token không hợp lệ' });

  req.user = user;
  next();
};

// Route đăng ký
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    return res.status(400).json({ success: false, message: 'Thiếu thông tin' });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } }
  });

  if (error) return res.status(400).json({ success: false, message: error.message });

  // Tạo profile
  const { error: profileError } = await supabase
    .from('profiles')
    .insert([{ id: data.user.id, username, rewards: 0 }]);

  if (profileError) {
    console.error('Lỗi tạo profile:', profileError);
    // Không return error để tránh block đăng ký, chỉ log
  }

  res.json({ success: true, message: 'Đăng ký thành công, kiểm tra email để xác nhận' });
});

// Route đăng nhập
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(401).json({ success: false, message: error.message });

  res.json({
    success: true,
    access_token: data.session.access_token,
    user_id: data.user.id,
    username: data.user.user_metadata?.username || ''
  });
});

// Route lấy điểm thưởng (protected - nếu frontend gửi token)
app.get('/rewards', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('rewards')
    .eq('id', req.user.id)
    .single();

  if (error || !data) return res.status(500).json({ success: false, message: 'Lỗi lấy điểm' });

  res.json({ success: true, rewards: data.rewards || 0 });
});

// Route nhận callback từ CPX để cộng thưởng
app.post('/update-reward', async (req, res) => {
  const { ext_user_id, reward_amount } = req.body;

  if (!ext_user_id || !reward_amount || isNaN(reward_amount)) {
    return res.status(400).json({ success: false, message: 'Thiếu hoặc sai định dạng dữ liệu' });
  }

  // Tăng rewards an toàn bằng RPC (bạn cần tạo RPC này trong Supabase một lần)
  const { error } = await supabase.rpc('increment_rewards', {
    user_id: ext_user_id,
    amount: Number(reward_amount)
  });

  if (error) {
    console.error('Lỗi cập nhật thưởng:', error);
    return res.status(500).json({ success: false, message: 'Lỗi server khi cập nhật' });
  }

  console.log(`Cộng ${reward_amount} điểm cho user ${ext_user_id}`);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server chạy tại http://localhost:${PORT}`);
});