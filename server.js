const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mineflayer = require('mineflayer');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// ================= PostgreSQL =================
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});
// ================= Bot =================
let bot = null; // botni qayta ulanadigan qilib o'zgartiramiz
const onlinePlayers = new Set();

function createBot() {
  bot = mineflayer.createBot({
    host: '176.114.72.37',
    port: 25575,
    username: 'BotName',
    version: '1.21'
  });

  bot.on('end', () => {
    console.log('Bot ulanmagan, 5 soniyadan keyin qayta ulanadi...');
    setTimeout(createBot, 5000); 
  });

  bot.on('error', (err) => {
    console.error('Bot xato:', err);
  });

  bot.on('playerJoined', async (player) => {
    onlinePlayers.add(player.username);
    try {
      const res = await pool.query('SELECT * FROM pending_items WHERE username=$1', [player.username]);
      for (const row of res.rows) {
        bot.chat(`/give ${player.username} minecraft:${row.item} ${row.amount}`);
      }
      await pool.query('DELETE FROM pending_items WHERE username=$1', [player.username]);
    } catch (err) {
      console.error(err);
    }
  });

  bot.on('playerLeft', (player) => onlinePlayers.delete(player.username));
}

// Botni boshlash
createBot();

// ================= Auth =================
const JWT_SECRET = 'SOME_SECRET_KEY';

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username va password kerak' });
  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query('INSERT INTO users (username, password, coins) VALUES ($1,$2,$3)', [username, hash, 100]);
    res.json({ success: true, message: 'Ro‘yxatdan o‘tildi' });
  } catch {
    res.status(400).json({ success: false, message: 'Username mavjud' });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  if (user.rows.length === 0) return res.status(400).json({ success: false, message: 'Username xato' });
  const valid = await bcrypt.compare(password, user.rows[0].password);
  if (!valid) return res.status(400).json({ success: false, message: 'Password xato' });
  const token = jwt.sign({ id: user.rows[0].id, username }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token });
});

// ================= Middleware =================
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ success: false, message: 'Token yo‘q' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Token xato' });
  }
}

// ================= User info =================
app.get('/me', auth, async (req, res) => {
  const userRes = await pool.query(
    'SELECT username, coins, rank FROM users WHERE id=$1',
    [req.user.id]
  );

  res.json({
    success: true,
    user: userRes.rows[0]
  });
});

// ================= Items =================
const ITEMS = [
  { id: 1, name: 'Totem', item: 'totem_of_undying', price: 1500, amount: 1 },
  { id: 2, name: 'Enchanted Golden Apple', item: 'enchanted_golden_apple', price: 2500, amount: 1 },  
  { id: 3, name: 'Mace', item: 'mace', price: 20000, amount: 1 },
  { id: 4, name: 'Elytra', item: 'elytra', price: 10000, amount: 1 },
  { id: 5, name: 'Villager Spawn Egg', item: 'villager_spawn_egg', price: 10000, amount: 1 },
  { id: 6, name: 'Wind Charge (64)', item: 'wind_charge', price: 1500, amount: 64 },
  { id: 7, name: 'End Crystal', item: 'end_crystal', price: 1500, amount: 1 },
  { id: 8, name: 'Respawn Anchor', item: 'respawn_anchor', price: 1000, amount: 1 },
  { id: 9, name: 'Trident', item: 'trident', price: 5000, amount: 1},
  { id: 10, name: 'Nether Star', item: 'nether_star', price: 3000, amount: 1 },
  { id: 11, name: 'bottle o\' enchanting (64)', item: 'experience_bottle', price: 4000, amount: 64 },
  { id: 12, name: 'Smithing Template', item: 'netherite_upgrade_smithing_template', price: 5000, amount: 1 }
];
const RANKS = {
  VIP: {
    type: 'coin',
    price: 50000,
    lpGroup: 'vip'
  },
  MVP: {
    type: 'money',
    price: 5, // dollar yoki ming so‘m (faqat info)
    lpGroup: 'mvp'
  },
  LEGEND: {
    type: 'money',
    price: 10,
    lpGroup: 'legend'
  }
};
app.post('/buy-rank/vip', auth, async (req, res) => {
  const rank = RANKS.VIP;

  try {
    const userRes = await pool.query(
      'SELECT coins, username, rank FROM users WHERE id=$1',
      [req.user.id]
    );

    const user = userRes.rows[0];

    if (user.rank !== 'PLAYER') {
      return res.status(400).json({ success:false, message:'Sizda allaqachon rank bor' });
    }

    if (user.coins < rank.price) {
      return res.status(400).json({ success:false, message:'Coin yetarli emas' });
    }

    // Coin yechish + rank yozish
    await pool.query(
      'UPDATE users SET coins=coins-$1, rank=$2 WHERE id=$3',
      [rank.price, 'VIP', req.user.id]
    );

    // Agar online bo‘lsa — darrov rank beriladi
    if (onlinePlayers.has(user.username)) {
      bot.chat(`/lp user ${user.username} parent set ${rank.lpGroup}`);
    }

    res.json({ success:true, message:'VIP rank muvaffaqiyatli sotib olindi!' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false, message:'Server xatosi' });
  }
});
app.post('/give-rank', async (req, res) => {
  const { username, rank } = req.body;

  if (!RANKS[rank]) {
    return res.status(400).json({ success:false, message:'Noto‘g‘ri rank' });
  }

  try {
    await pool.query(
      'UPDATE users SET rank=$1 WHERE username=$2',
      [rank, username]
    );

    if (onlinePlayers.has(username)) {
      bot.chat(`/lp user ${username} parent set ${RANKS[rank].lpGroup}`);
    }

    res.json({ success:true, message:`${username} ga ${rank} berildi` });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success:false });
  }
});

// ================= Foydalanuvchiga coin berish =================
app.post('/givecoin', async (req, res) => {
    const { username, amount } = req.body;

    // 1. Tekshiruvlar
    if (!username || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Username yoki amount noto‘g‘ri' });
    }

    try {
        // 2. Foydalanuvchini topish
        const userRes = await pool.query('SELECT coins FROM users WHERE username=$1', [username]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User topilmadi' });
        }

        const newCoins = userRes.rows[0].coins + amount;

        // 3. Coin miqdorini yangilash
        await pool.query('UPDATE users SET coins=$1 WHERE username=$2', [newCoins, username]);

        res.json({
            success: true,
            message: `${username} ga ${amount} coin berildi`,
            coins: newCoins
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Serverda xatolik yuz berdi' });
    }
});

// ================= Sotib olish =================
app.post('/buy-item', auth, async (req, res) => {
  const { itemId, quantity } = req.body; // quantity qo'shildi
  const item = ITEMS.find(i => i.id === itemId);
  if (!item) return res.status(400).json({ success: false, message: 'Item topilmadi' });

  const qty = parseInt(quantity) || 1; // default 1 ta
  if(qty <= 0) return res.status(400).json({ success: false, message: 'Miqdor 1 dan kichik bo‘lishi mumkin emas' });

  const totalPrice = item.price * qty; // umumiy narx

  const userRes = await pool.query('SELECT coins, username FROM users WHERE id=$1', [req.user.id]);
  const user = userRes.rows[0];
  if (user.coins < totalPrice) return res.status(400).json({ success: false, message: 'Coin yetarli emas' });

  await pool.query('UPDATE users SET coins=coins-$1 WHERE id=$2', [totalPrice, req.user.id]);

  if (onlinePlayers.has(user.username)) {
    bot.chat(`/give ${user.username} minecraft:${item.item} ${item.amount * qty}`);
  } else {
    await pool.query(
      'INSERT INTO pending_items (username, item, amount) VALUES ($1,$2,$3)',
      [user.username, item.item, item.amount * qty]
    );
  }

  res.json({ success: true, message: `Siz ${item.name} ni ${qty} dona sotib oldingiz!` });
});

// Mini-o‘yin orqali coin berish
// Mini-o‘yin orqali coin berish (frontenddan coin miqdori keladi)
app.post('/play-game', auth, async (req, res) => {
  let coinsEarned = req.body.coinsEarned;

  if (!coinsEarned || coinsEarned <= 0) {
    // default random coin agar kelmasa
    coinsEarned = Math.floor(Math.random() * 16) + 5; 
  }

  try {
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [coinsEarned, req.user.id]);
    res.json({ success: true, message: `Siz ${coinsEarned} coin yutdingiz!`, coinsEarned });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Coin berishda xatolik' });
  }
});

// ================= Server =================
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server http://localhost:${PORT} da ishlayapti`));
