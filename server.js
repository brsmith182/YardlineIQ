const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('redis');
const crypto = require('crypto');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Admin password
const ADMIN_PASSWORD = 'yardline2025';

// Initialize Redis client
let redisClient;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL
    });
    
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    await redisClient.connect();
  }
  return redisClient;
}

// Basic middleware
app.use(express.json());
app.use(express.static('public'));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', '*');
  next();
});


// Admin authentication
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: 'admin-authenticated' });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Check auth middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader === 'Bearer admin-authenticated') {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Redis helper functions
async function saveEmailToRedis(email) {
  try {
    const client = await getRedisClient();
    const emailLower = email.toLowerCase();
    const timestamp = Date.now();
    
    const emailEntry = {
      email: emailLower,
      signupDate: new Date().toISOString(),
      timestamp: timestamp,
      type: 'free_pick'
    };
    
    // Store individual email
    await client.set(`email:${emailLower}`, JSON.stringify(emailEntry));
    
    // Add to list of all emails
    await client.sAdd('all_emails', emailLower);
    
    console.log(`Email saved to Redis: ${email}`);
    return { success: true };
    
  } catch (error) {
    console.error('Redis email save error:', error);
    return { success: false, error: error.message };
  }
}

async function saveCustomerToRedis(customerData) {
  try {
    const client = await getRedisClient();
    const email = customerData.email.toLowerCase();
    
    const subscriberData = {
      ...customerData,
      timestamp: Date.now(),
      signupDate: new Date().toISOString(),
      type: 'paid_subscriber'
    };
    
    // Store individual subscriber
    await client.set(`customer:${email}`, JSON.stringify(subscriberData));
    
    // Add to list of all customers
    await client.sAdd('all_customers', email);
    
    console.log(`Customer saved to Redis: ${email}`);
    return { success: true };
    
  } catch (error) {
    console.error('Redis customer save error:', error);
    return { success: false, error: error.message };
  }
}

async function savePurchaseToRedis(purchaseData) {
  try {
    const client = await getRedisClient();
    const email = purchaseData.email.toLowerCase();
    const pid = purchaseData.paymentIntentId;

    const record = {
      ...purchaseData,
      email,
      timestamp: Date.now(),
      purchaseDate: new Date().toISOString()
    };

    // Individual purchase record keyed by Stripe payment intent ID
    await client.set(`purchase:${pid}`, JSON.stringify(record));

    // Per-customer purchase index
    await client.sAdd(`purchases:${email}`, pid);

    // Global purchase index for revenue calculations
    await client.sAdd('all_purchases', pid);

    // Running revenue total
    await client.incrByFloat('total_revenue', purchaseData.amount || 0);

    console.log(`Purchase saved: ${pid} for ${email} — $${purchaseData.amount}`);
    return { success: true };
  } catch (error) {
    console.error('Redis purchase save error:', error);
    return { success: false, error: error.message };
  }
}

async function getPurchasesByEmail(email) {
  try {
    const client = await getRedisClient();
    const emailLower = email.toLowerCase();
    const ids = await client.sMembers(`purchases:${emailLower}`);
    const purchases = [];
    for (const id of ids) {
      const data = await client.get(`purchase:${id}`);
      if (data) purchases.push(JSON.parse(data));
    }
    purchases.sort((a, b) => b.timestamp - a.timestamp);
    return purchases;
  } catch (error) {
    console.error('Redis purchase retrieval error:', error);
    return [];
  }
}

async function getAllEmailsFromRedis() {
  try {
    const client = await getRedisClient();
    const emailList = await client.sMembers('all_emails');
    const emails = [];
    
    for (const email of emailList) {
      const emailData = await client.get(`email:${email}`);
      if (emailData) {
        emails.push(JSON.parse(emailData));
      }
    }
    
    return emails;
  } catch (error) {
    console.error('Redis email retrieval error:', error);
    return [];
  }
}

async function getAllCustomersFromRedis() {
  try {
    const client = await getRedisClient();
    const customerEmails = await client.sMembers('all_customers');
    const customers = [];

    for (const email of customerEmails) {
      const customerData = await client.get(`customer:${email}`);
      if (customerData) {
        customers.push(JSON.parse(customerData));
      }
    }

    return customers;
  } catch (error) {
    console.error('Redis customer retrieval error:', error);
    return [];
  }
}

// Handle email signups - Redis version
app.post('/api/email/free-pick', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    
    const result = await saveEmailToRedis(email);
    
    if (result.success) {
      res.json({ 
        success: true,
        message: 'You have been successfully registered for this week\'s Free Pick! Email will be sent out prior to the game. Thank you and Good Luck!'
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to save email',
        details: result.error 
      });
    }
    
  } catch (error) {
    console.error('Email signup error:', error);
    res.status(500).json({ 
      error: 'Failed to process signup',
      details: error.message 
    });
  }
});

// Handle old email signup paths
app.post('/api/email/*', (req, res) => {
  console.log('Redirecting old email path to new handler');
  req.url = '/api/email/free-pick';
  app._router.handle(req, res);
});

// Create payment intent
app.post('/api/payments/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency, packageType, customerInfo } = req.body;
    
    if (!customerInfo || !customerInfo.name || !customerInfo.email) {
      return res.status(400).json({ error: 'Customer name and email are required' });
    }
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: currency || 'usd',
      metadata: {
        packageType,
        userEmail: customerInfo.email,
        userName: customerInfo.name,
        purchaseDate: new Date().toISOString()
      }
    });
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error('Payment intent creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle successful payment - Redis version
app.post('/api/payments/payment-success', async (req, res) => {
  try {
    const { paymentIntentId, customerInfo, packageType } = req.body;
    
    if (!customerInfo || !customerInfo.email || !customerInfo.name) {
      return res.status(400).json({ error: 'Customer information is required' });
    }
    
    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status === 'succeeded') {
      // Calculate subscription end date
      let subscriptionEnd;
      if (packageType === 'weekly') {
        subscriptionEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      } else if (packageType === 'monthly') {
        subscriptionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else if (packageType === 'season') {
        subscriptionEnd = new Date('2027-02-15');
      }
      
      // Create customer object
      const customer = {
        id: Date.now(),
        name: customerInfo.name,
        email: customerInfo.email,
        packageType: packageType,
        purchaseDate: new Date(),
        subscriptionEnd: subscriptionEnd,
        paymentId: paymentIntentId,
        status: 'active'
      };
      
      // Save/update customer subscription record
      const result = await saveCustomerToRedis(customer);
      if (!result.success) {
        console.error('Failed to save customer to Redis:', result.error);
      }

      // Save individual purchase record for history and revenue tracking
      await savePurchaseToRedis({
        paymentIntentId: paymentIntentId,
        email: customerInfo.email,
        name: customerInfo.name,
        packageType: packageType,
        amount: paymentIntent.amount / 100
      });

      // Send notification email
      await sendNotificationEmail('payment', {
        name: customerInfo.name,
        email: customerInfo.email,
        packageType: packageType,
        amount: paymentIntent.amount / 100
      });
      
      res.json({
        success: true,
        message: 'Payment processed successfully!',
        userId: customer.id,
        subscriptionEnd: subscriptionEnd
      });
    } else {
      res.status(400).json({ error: 'Payment not successful' });
    }
  } catch (error) {
    console.error('Payment success error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get customers for admin dashboard - Redis version
app.get('/api/payments/customers', requireAuth, async (req, res) => {
  try {
    const customers = await getAllCustomersFromRedis();
    const enriched = await Promise.all(customers.map(async (c) => {
      const purchases = await getPurchasesByEmail(c.email);
      const totalSpent = purchases.reduce((sum, p) => sum + (p.amount || 0), 0);
      return { ...c, purchases, totalSpent: totalSpent.toFixed(2) };
    }));
    res.json({ customers: enriched.reverse() });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Member authentication
app.post('/api/member/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const client = await getRedisClient();
    const emailLower = email.toLowerCase().trim();

    // Only paid customers get access
    const customerData = await client.get(`customer:${emailLower}`);

    if (!customerData) {
      const freeData = await client.get(`email:${emailLower}`);
      if (freeData) {
        return res.status(403).json({
          error: 'paid_required',
          message: 'A paid subscription is required to access picks. Visit our packages page to get started.'
        });
      }
      return res.status(401).json({ error: 'Email not found. Please check your email or purchase a subscription.' });
    }

    const customer = JSON.parse(customerData);
    const now = Date.now();
    const subEnd = new Date(customer.subscriptionEnd).getTime();

    if (subEnd <= now) {
      return res.status(403).json({
        error: 'subscription_expired',
        message: 'Your subscription has expired. Purchase a new package to regain access.'
      });
    }

    // Issue a session token that expires when the subscription does
    const token = crypto.randomBytes(32).toString('hex');
    const ttlSeconds = Math.floor((subEnd - now) / 1000);
    await client.set(`session:${token}`, emailLower, { EX: ttlSeconds });

    res.json({
      success: true,
      token,
      user: {
        email: customer.email,
        name: customer.name || '',
        packageType: customer.packageType,
        subscriptionEnd: customer.subscriptionEnd
      }
    });

  } catch (error) {
    console.error('Member login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Member logout — invalidates session token
app.post('/api/member/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const client = await getRedisClient();
      await client.del(`session:${token}`);
    }
    res.json({ success: true });
  } catch (error) {
    res.json({ success: true }); // always succeed
  }
});

// Post new pick (protected)
app.post('/api/picks', requireAuth, async (req, res) => {
  try {
    console.log('Pick submission:', req.body);

    const { week, game, time, pick, confidence, reasoning } = req.body;

    if (!week || !game || !pick) {
      return res.status(400).json({ error: 'Week, game, and pick are required' });
    }

    const newPick = {
      id: Date.now().toString(),
      week: week.toString().trim(),
      game: game.toString().trim(),
      time: time || '',
      pick: pick.toString().trim(),
      confidence: confidence || '',
      reasoning: reasoning || '',
      datePosted: new Date().toISOString(),
      result: 'pending'
    };

    const client = await getRedisClient();
    await client.set(`pick:${newPick.id}`, JSON.stringify(newPick));
    await client.sAdd('all_picks', newPick.id);

    console.log('Pick saved to Redis:', newPick.id);

    res.json({ success: true, message: 'Pick posted successfully!', pick: newPick });

  } catch (error) {
    console.error('Error adding pick:', error);
    res.status(500).json({ error: 'Failed to post pick' });
  }
});

// Update a pick's result — admin only (win / loss / push / pending)
app.patch('/api/picks/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['win', 'loss', 'push', 'pending'];
    const normalized = (req.body.result || '').toString().trim().toLowerCase();
    if (!allowed.includes(normalized)) {
      return res.status(400).json({ error: `result must be one of: ${allowed.join(', ')}` });
    }

    const client = await getRedisClient();
    const key = `pick:${req.params.id}`;
    const data = await client.get(key);
    if (!data) {
      return res.status(404).json({ error: 'Pick not found' });
    }

    const pick = JSON.parse(data);
    pick.result = normalized;
    await client.set(key, JSON.stringify(pick));

    console.log('Pick result updated:', req.params.id, '->', normalized);
    res.json({ success: true, pick });
  } catch (error) {
    console.error('Error updating pick result:', error);
    res.status(500).json({ error: 'Failed to update pick' });
  }
});

// Get picks — requires valid member session token
app.get('/api/picks', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);

    // Allow admin token to bypass member session check
    const isAdmin = authHeader === 'Bearer admin-authenticated';

    // --- DEV STUB: return hardcoded pick when Redis is unavailable ---
    if (!process.env.REDIS_URL) {
      if (!isAdmin) return res.status(401).json({ error: 'Authentication required' });
      return res.json([{
        id: 1,
        week: 'Super Bowl LX',
        game: 'New England Patriots vs Seattle Seahawks',
        time: 'February 8, 2026 · 6:30 PM ET',
        pick: 'Seattle Seahawks -4.5',
        confidence: 'High',
        reasoning: 'Seahawks cover because their defense creates negative plays and turnovers, their special teams win hidden yardage, and their offense does enough without giving the Patriots short fields.',
        result: 'Win'
      }]);
    }
    // ----------------------------------------------------------------

    const client = await getRedisClient();
    const email = isAdmin ? 'admin' : await client.get(`session:${token}`);

    if (!email) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const ids = await client.sMembers('all_picks');
    const picks = [];
    for (const id of ids) {
      const data = await client.get(`pick:${id}`);
      if (data) picks.push(JSON.parse(data));
    }
    picks.sort((a, b) => b.id - a.id);

    console.log('Picks requested by', email, '— returning', picks.length, 'picks');
    res.json(picks);
  } catch (error) {
    console.error('Error fetching picks:', error);
    res.status(500).json({ error: 'Failed to fetch picks' });
  }
});

// ===================== HANDLE REPORT (member-gated) =====================
// The handle report is a snapshot that gets replaced wholesale each time the
// admin posts fresh numbers, so it lives under a single key instead of the
// per-id pattern picks use.

// Post/replace handle report — admin only. Body: array of games (or { games: [...] }).
// Posting an empty array clears the report.
app.post('/api/handle', requireAuth, async (req, res) => {
  try {
    const games = Array.isArray(req.body) ? req.body : req.body.games;
    if (!Array.isArray(games)) {
      return res.status(400).json({ error: 'Body must be an array of games (or { games: [...] })' });
    }
    for (const g of games) {
      if (!g || typeof g.game !== 'string' || !g.game.trim()) {
        return res.status(400).json({ error: 'Every game needs a "game" field, e.g. "Chiefs vs Chargers"' });
      }
    }

    const client = await getRedisClient();
    await client.set('handle_games', JSON.stringify(games));

    console.log('Handle report updated —', games.length, 'games');
    res.json({ success: true, count: games.length });
  } catch (error) {
    console.error('Error saving handle report:', error);
    res.status(500).json({ error: 'Failed to save handle report' });
  }
});

// Get handle report — requires valid member session token
app.get('/api/handle', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);

    // Allow admin token to bypass member session check
    const isAdmin = authHeader === 'Bearer admin-authenticated';

    // --- DEV STUB: no Redis locally — admin sees an empty report ---
    if (!process.env.REDIS_URL) {
      if (!isAdmin) return res.status(401).json({ error: 'Authentication required' });
      return res.json([]);
    }
    // ----------------------------------------------------------------

    const client = await getRedisClient();
    const email = isAdmin ? 'admin' : await client.get(`session:${token}`);

    if (!email) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    const data = await client.get('handle_games');
    const games = data ? JSON.parse(data) : [];

    console.log('Handle report requested by', email, '— returning', games.length, 'games');
    res.json(games);
  } catch (error) {
    console.error('Error fetching handle report:', error);
    res.status(500).json({ error: 'Failed to fetch handle report' });
  }
});

// ===================== BETTING TRENDS (member-gated) =====================
// Verified trend-mining findings — the single source of truth for /trends.html.
// Update this array from the workbook and deploy; there is no separate trend store.
// Each trend records the *actionable* side and its
// cover/hit rate, the sample size (n), and the exact-binomial p-value. The frontend
// converts p into a Confidence label (Very High / High / Moderate / Speculative) and
// uses `group` for the card label.
//
// Source: NFL_Betting_Trends_MASTER_VERIFIED_2018_2025.xlsx — 490 trends recomputed on
// 2018–2025 data (2,227 games, all game types; 2,175 ATS-graded / 2,205 totals-graded,
// pushes excluded). Published set = every "as documented" row with p < 0.05, plus the
// previously published trends (values refreshed even where they no longer clear p < 0.05).
// Deliberately excluded: the 142 "flipped to winner" rows, whose winning side was chosen
// post hoc so their p-values are optimistic; and "Spread of exactly 14 ... prices not
// equal" (84.6%, n=26), which the workbook flags as an isolated artifact — the
// neighbouring 13 / 13.5 / 14.5 buckets run 47.8 / 52.6 / 58.3%.
const TRENDS = [
  // ─── Against the spread ─────────────────────────────────────────────
  { category: 'spread', tier: 1, group: 'Cross-market', trend: 'Totals/spread avg-ticket pctile > 14.55%; Over ticket % ≤ 76.13%; dog sharp gap > 6.47%', side: 'Underdog', n: 455, rate: 60.66, p: 6e-06 },
  { category: 'spread', tier: 1, group: 'Cross-market', trend: 'Sharp dog ≥ 6 pts; Over tickets ≤ 75%; totals/spread average-ticket percentile ≥ 30%', side: 'Underdog', n: 395, rate: 60.76, p: 2.2e-05 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Adaptive: dog-side sharp gap in the top quartile of the season', side: 'Underdog', n: 545, rate: 58.9, p: 3.8e-05 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 6 pts', side: 'Underdog', n: 720, rate: 57.64, p: 4.7e-05 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 5 pts', side: 'Underdog', n: 850, rate: 56.47, p: 0.000182 },
  { category: 'spread', tier: 1, group: 'Cross-market', trend: 'Sharp dog gap ≥ 6 pts AND totals sharp gap toward UNDER ≥ 8 pts', side: 'Underdog', n: 240, rate: 61.25, p: 0.000595 },
  { category: 'spread', tier: 1, group: 'Cross-market', trend: 'Sharp dog ≥5 + sharp UNDER ≥8', side: 'Underdog', n: 279, rate: 60.22, p: 0.000771 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp dog with a mid implied total: gap ≥ 6 pts AND dog implied team total 17.5–21', side: 'Underdog', n: 331, rate: 59.21, p: 0.000946 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp dog the experts hate: gap ≥ 6 pts AND expert ATS consensus on the dog ≤ 40%', side: 'Underdog', n: 492, rate: 57.52, p: 0.000979 },
  { category: 'spread', tier: 1, group: 'Key numbers', trend: 'Sharp dog (gap ≥ 5 pts) with spread 7–9.5', side: 'Underdog', n: 165, rate: 63.03, p: 0.001016 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Broad divergence: absolute sharp gap ≥ 6 pts', side: 'Sharp side', n: 948, rate: 55.38, p: 0.001027 },
  { category: 'spread', tier: 1, group: 'Situational', trend: 'Away team, weeks 5–9, spread < 3', side: 'Away team', n: 146, rate: 63.7, p: 0.001173 },
  { category: 'spread', tier: 1, group: 'Liquidity & attention', trend: 'Sharp side in a high average-wager market: gap ≥ 6 pts AND top-30% average ticket size', side: 'Sharp side', n: 241, rate: 60.58, p: 0.001232 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Silent sharp dog: gap ≥ 8 pts on the dog with dog cash share < 60%', side: 'Underdog', n: 478, rate: 57.32, p: 0.001573 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp money on the away side: gap toward away ≥ 5 pts', side: 'Away team', n: 469, rate: 57.36, p: 0.001661 },
  { category: 'spread', tier: 1, group: 'Spread price', trend: 'Spread of 10 or more (either side) and the two spread prices are not equal', side: 'More expensive side', n: 246, rate: 60.16, p: 0.001727 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 4 pts', side: 'Underdog', n: 980, rate: 55, p: 0.00193 },
  { category: 'spread', tier: 1, group: 'Cross-market', trend: 'Sharp dog gap ≥ 6 pts AND totals sharp gap toward UNDER ≥ 6 pts', side: 'Underdog', n: 305, rate: 59.02, p: 0.001939 },
  { category: 'spread', tier: 1, group: 'Public money', trend: 'Big bets on away: log bet-size ratio ≤ −0.15', side: 'Away team', n: 309, rate: 58.9, p: 0.002077 },
  { category: 'spread', tier: 1, group: 'Situational', trend: 'Sharp dog on the road (gap ≥ 5 pts)', side: 'Road underdog', n: 421, rate: 57.48, p: 0.002473 },
  { category: 'spread', tier: 1, group: 'Sharp divergence', trend: 'Sharp dog in a low-scoring game: gap ≥ 6 pts AND game total ≤ 42', side: 'Underdog', n: 181, rate: 61.33, p: 0.002844 },
  { category: 'spread', tier: 2, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 8 pts', side: 'Underdog', n: 511, rate: 56.56, p: 0.003464 },
  { category: 'spread', tier: 2, group: 'Sharp divergence', trend: 'Sharp money on the away side: gap toward away ≥ 10 pts', side: 'Away team', n: 173, rate: 61.27, p: 0.003738 },
  { category: 'spread', tier: 2, group: 'Cross-market', trend: 'Sharp dog ≥5 + sharp UNDER ≥6', side: 'Underdog', n: 357, rate: 57.7, p: 0.004199 },
  { category: 'spread', tier: 2, group: 'Streaks & form', trend: 'Team was an underdog last game and is now a favorite', side: 'Fade that team', n: 827, rate: 55.02, p: 0.004324 },
  { category: 'spread', tier: 2, group: 'Line movement', trend: 'Sharp dog (≥5 pts) and the line stays flat (< 1 point)', side: 'Underdog', n: 265, rate: 58.87, p: 0.004625 },
  { category: 'spread', tier: 2, group: 'Cross-market', trend: 'Sharp dog ≥6 + sharp UNDER ≥4', side: 'Underdog', n: 358, rate: 57.54, p: 0.005022 },
  { category: 'spread', tier: 2, group: 'Cross-market', trend: 'Sharp dog ≥5 + public OVER tickets ≥60%', side: 'Underdog', n: 572, rate: 55.94, p: 0.005044 },
  { category: 'spread', tier: 2, group: 'Spread price', trend: 'Home team favored by 10 or more and the home side carries the more expensive price', side: 'Home team', n: 53, rate: 69.81, p: 0.005486 },
  { category: 'spread', tier: 2, group: 'Situational', trend: 'Away team on non-grass surface with spread < 3', side: 'Away team', n: 220, rate: 59.55, p: 0.005584 },
  { category: 'spread', tier: 2, group: 'Cross-market', trend: 'Sharp dog ≥5 + sharp UNDER ≥4', side: 'Underdog', n: 421, rate: 56.77, p: 0.00628 },
  { category: 'spread', tier: 2, group: 'Liquidity & attention', trend: 'Low-handle games with sharp divergence ≥ 5 pts either side', side: 'Sharp side', n: 254, rate: 58.66, p: 0.006858 },
  { category: 'spread', tier: 2, group: 'Spread price', trend: 'Spread of 10 or more (either side) and the HOME side carries the more expensive price', side: 'Home team', n: 102, rate: 63.73, p: 0.007206 },
  { category: 'spread', tier: 2, group: 'Cross-market', trend: 'Sharp dog ≥8 + sharp UNDER ≥8', side: 'Underdog', n: 172, rate: 60.47, p: 0.007434 },
  { category: 'spread', tier: 2, group: 'Cross-market', trend: 'Sharp dog ≥6 + public OVER tickets ≥60%', side: 'Underdog', n: 479, rate: 56.16, p: 0.007981 },
  { category: 'spread', tier: 2, group: 'Sharp divergence', trend: 'Silent sharp meeting line resistance: silent sharp AND line moves against the sharp side ≥ 0.5', side: 'Sharp side', n: 277, rate: 58.12, p: 0.008085 },
  { category: 'spread', tier: 2, group: 'Spread price', trend: 'Cash leans to the away side by 5+ pts AND the away side carries the more expensive price', side: 'Away team', n: 255, rate: 58.43, p: 0.008407 },
  { category: 'spread', tier: 2, group: 'Spread price', trend: 'Home spread price is even money or better (≥ −100)', side: 'Away team', n: 395, rate: 56.71, p: 0.008802 },
  { category: 'spread', tier: 2, group: 'Spread price', trend: 'Cash leans to the away side by 10+ pts AND the away side carries the more expensive price', side: 'Away team', n: 108, rate: 62.96, p: 0.009058 },
  { category: 'spread', tier: 2, group: 'Coach / QB', trend: 'Dan Campbell-coached teams against the spread', side: 'Dan Campbell\'s team', n: 87, rate: 64.37, p: 0.009673 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Divisional dog with sharp money on the dog', side: 'Underdog', n: 308, rate: 57.47, p: 0.010228 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Broad divergence: absolute sharp gap ≥ 4 pts', side: 'Sharp side', n: 1317, rate: 53.53, p: 0.011214 },
  { category: 'spread', tier: 3, group: 'Line movement', trend: 'Sharp dog (≥5 pts) and the line moves against the dog by ≥ 1 point', side: 'Underdog', n: 376, rate: 56.65, p: 0.011406 },
  { category: 'spread', tier: 3, group: 'Liquidity & attention', trend: 'Totals average wager low relative to the spread (bottom 20%)', side: 'Underdog', n: 431, rate: 56.15, p: 0.012165 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Silent sharp: divergence ≥ 8 pts while the sharp side\'s cash share stays under 60%', side: 'Sharp side', n: 577, rate: 55.29, p: 0.012429 },
  { category: 'spread', tier: 3, group: 'Weather', trend: 'Underdog in an indoor/closed-roof September game (week ≤ 4)', side: 'Underdog', n: 165, rate: 60, p: 0.012496 },
  { category: 'spread', tier: 3, group: 'Key numbers', trend: 'Sharp side sitting on key number 7: gap ≥ 6 pts AND closing spread within 0.5 of 7', side: 'Sharp side', n: 147, rate: 60.54, p: 0.013078 },
  { category: 'spread', tier: 3, group: 'Streaks & form', trend: 'On a 3+ straight-up losing streak and now an underdog', side: 'The team', n: 496, rate: 55.65, p: 0.013447 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Sharp money on the away side: gap toward away ≥ 8 pts', side: 'Away team', n: 252, rate: 57.94, p: 0.013859 },
  { category: 'spread', tier: 3, group: 'Coach / QB', trend: 'Jared Goff\'s team against the spread', side: 'Jared Goff\'s team', n: 133, rate: 60.9, p: 0.014873 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 3 pts', side: 'Underdog', n: 1112, rate: 53.69, p: 0.015102 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 10 pts', side: 'Underdog', n: 352, rate: 56.53, p: 0.01634 },
  { category: 'spread', tier: 3, group: 'Public money', trend: 'Bet-size ratio ≤ 0.67 (away average wager much larger)', side: 'Away team', n: 244, rate: 57.79, p: 0.017671 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Home underdog +7.5 to +10', side: 'Home underdog', n: 87, rate: 63.22, p: 0.017828 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Away divisional side with sharp money: divisional AND gap toward away ≥ 4 pts', side: 'Away team', n: 198, rate: 58.59, p: 0.018789 },
  { category: 'spread', tier: 3, group: 'Liquidity & attention', trend: 'Sharp dog ≥6 + top 30% totals/spread dollar ratio', side: 'Underdog', n: 154, rate: 59.74, p: 0.01915 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Away favorite of 7+ with home tickets ≤ 35%', side: 'Home underdog', n: 178, rate: 58.99, p: 0.019892 },
  { category: 'spread', tier: 3, group: 'Cross-market', trend: 'Sharp dog ≥8 + sharp UNDER ≥6', side: 'Underdog', n: 216, rate: 57.87, p: 0.024519 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Sharp dog at home (gap ≥ 5 pts)', side: 'Home underdog', n: 429, rate: 55.48, p: 0.026243 },
  { category: 'spread', tier: 3, group: 'Liquidity & attention', trend: 'Low-handle games (bottom 20% of season dollars)', side: 'Underdog', n: 433, rate: 55.43, p: 0.026947 },
  { category: 'spread', tier: 3, group: 'Line movement', trend: 'Sharp buyback: sharp gap toward away ≥ 5 pts and line moves toward home ≥ 1', side: 'Away team', n: 169, rate: 58.58, p: 0.030948 },
  { category: 'spread', tier: 3, group: 'Liquidity & attention', trend: 'Sharp dog ≥6 + top 19% totals ticket volume', side: 'Underdog', n: 87, rate: 62.07, p: 0.031418 },
  { category: 'spread', tier: 3, group: 'Key numbers', trend: 'Sharp dog (gap ≥ 5 pts) with spread 0.5–3', side: 'Underdog', n: 266, rate: 56.77, p: 0.03168 },
  { category: 'spread', tier: 3, group: 'Sharp divergence', trend: 'Sharp money on the underdog: dog-side (cash% − ticket%) ≥ 2 pts', side: 'Underdog', n: 1248, rate: 53.04, p: 0.033711 },
  { category: 'spread', tier: 3, group: 'Key numbers', trend: 'Home underdog 7+ AND normalized-spread top quintile (low total)', side: 'Home underdog', n: 118, rate: 60.17, p: 0.033788 },
  { category: 'spread', tier: 3, group: 'Cross-market', trend: 'Sharp dog ≥6 + sharp OVER ≥4', side: 'Underdog', n: 111, rate: 60.36, p: 0.036306 },
  { category: 'spread', tier: 3, group: 'Spread price', trend: 'Underdog\'s spread price is even money or better (≥ −100)', side: 'Away team', n: 331, rate: 55.89, p: 0.036578 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Away team, total ≥ 48, weeks 5–9', side: 'Away team', n: 181, rate: 58.01, p: 0.03712 },
  { category: 'spread', tier: 3, group: 'Totals context', trend: 'Game total line < 40', side: 'Home team', n: 209, rate: 57.42, p: 0.037719 },
  { category: 'spread', tier: 3, group: 'Key numbers', trend: 'Normalized-spread top quintile AND home underdog', side: 'Home underdog', n: 119, rate: 59.66, p: 0.043268 },
  { category: 'spread', tier: 3, group: 'Liquidity & attention', trend: 'Sharp dog ≥8 + bottom 19% totals/spread dollar ratio', side: 'Underdog', n: 143, rate: 58.74, p: 0.044373 },
  { category: 'spread', tier: 3, group: 'Spread price', trend: 'Home and away spread prices differ by 20 cents or more', side: 'Away team', n: 695, rate: 53.81, p: 0.048478 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Home underdog of 7 or more (fade the road favorite −7+)', side: 'Home underdog', n: 191, rate: 57.07, p: 0.059648 },
  { category: 'spread', tier: 3, group: 'Streaks & form', trend: 'Weeks 1–4, off an ATS loss', side: 'The team', n: 505, rate: 54.26, p: 0.061519 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Home team implied total ≤ 17 (any spread)', side: 'Home team', n: 118, rate: 58.47, p: 0.079834 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Home underdog of 7+ with home implied total ≤ 17', side: 'Home underdog', n: 74, rate: 60.81, p: 0.080507 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Divisional underdog', side: 'Underdog', n: 770, rate: 53.12, p: 0.090245 },
  { category: 'spread', tier: 3, group: 'Weather', trend: 'Underdog with wind 10–14 mph', side: 'Underdog', n: 317, rate: 54.89, p: 0.091837 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Road underdog +4.5 to +6', side: 'Road underdog', n: 198, rate: 56.06, p: 0.101904 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Any underdog +7.5 to +9.5', side: 'Underdog', n: 242, rate: 54.55, p: 0.176916 },
  { category: 'spread', tier: 3, group: 'Schedule & rest', trend: 'Off a bye (rest ≥ 10 days) AND an underdog', side: 'Underdog', n: 244, rate: 53.69, p: 0.276427 },
  { category: 'spread', tier: 3, group: 'Streaks & form', trend: 'Home underdog after a straight-up loss', side: 'Home underdog', n: 532, rate: 52.07, p: 0.36259 },
  { category: 'spread', tier: 3, group: 'Streaks & form', trend: 'Home underdog off an ATS loss of 14+', side: 'Home underdog', n: 224, rate: 53.12, p: 0.385111 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Home team, weeks 14–18, |spread| ≥ 7', side: 'Home team', n: 201, rate: 53.23, p: 0.397378 },
  { category: 'spread', tier: 3, group: 'Situational', trend: 'Home favorite of 10.5 or more', side: 'Home favorite', n: 173, rate: 52.6, p: 0.54316 },

  // ─── Totals ─────────────────────────────────────────────────────────
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Wind > 9.5; totals/spread dollar pctile > 37.69%; Cover Difficulty ≤ 0.4957', side: 'Under', n: 214, rate: 65.89, p: 4e-06 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Wind ≥ 10 mph AND relative totals/spread dollar percentile ≥ 40%', side: 'Under', n: 308, rate: 62.99, p: 6e-06 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Wind ≥ 10 mph; totals/spread dollar percentile ≥ 40%; Cover Difficulty Index ≤ 0.50', side: 'Under', n: 208, rate: 65.87, p: 6e-06 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Wind > 9.5 AND totals/spread dollar pctile > 37.69%', side: 'Under', n: 316, rate: 62.66, p: 8e-06 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Totals sharp gap toward UNDER ≥ 4 pts AND relative totals/spread dollars bottom 40%', side: 'Over', n: 448, rate: 58.04, p: 0.000777 },
  { category: 'total', tier: 4, group: 'Totals context', trend: 'Wind 11–15 mph', side: 'Under', n: 278, rate: 60.07, p: 0.000938 },
  { category: 'total', tier: 4, group: 'Liquidity & attention', trend: 'Relative totals/spread dollar percentile > 40%', side: 'Under', n: 1324, rate: 54.46, p: 0.001294 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Totals sharp gap toward UNDER ≥ 4 pts AND spread 7–9.5', side: 'Over', n: 162, rate: 62.35, p: 0.002087 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Totals sharp-gap percentile bottom 40% AND relative totals/spread dollar percentile bottom 40%', side: 'Over', n: 388, rate: 57.73, p: 0.002696 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Totals sharp gap toward UNDER ≥ 4 pts AND wind ≥ 10 mph', side: 'Under', n: 259, rate: 57.92, p: 0.012787 },
  { category: 'total', tier: 4, group: 'Liquidity & attention', trend: 'Sharp UNDER ≥4 pts + top 30% totals/spread ticket ratio', side: 'Under', n: 253, rate: 57.71, p: 0.016722 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Totals sharp gap toward UNDER ≥ 4 pts AND wind < 10 mph', side: 'Over', n: 771, rate: 54.35, p: 0.017401 },
  { category: 'total', tier: 4, group: 'Totals context', trend: 'Wind ≥10 + public OVER tickets ≥60%', side: 'Under', n: 312, rate: 56.73, p: 0.020131 },
  { category: 'total', tier: 4, group: 'Cross-market', trend: 'Totals sharp gap toward UNDER ≥ 4 pts AND game total > 49', side: 'Under', n: 181, rate: 58.56, p: 0.025483 },
  { category: 'total', tier: 4, group: 'Liquidity & attention', trend: 'Relative totals/spread dollar percentile 20–40%', side: 'Over', n: 441, rate: 55.33, p: 0.028376 },
  { category: 'total', tier: 4, group: 'Totals context', trend: 'Primetime + public OVER tickets ≥60%', side: 'Under', n: 396, rate: 55.56, p: 0.030579 },
  { category: 'total', tier: 4, group: 'Totals context', trend: 'Primetime game', side: 'Under', n: 579, rate: 54.58, p: 0.030603 },
  { category: 'total', tier: 4, group: 'Liquidity & attention', trend: 'Both spread and totals ticket volume in the top 30% of the season', side: 'Under', n: 478, rate: 55.02, p: 0.031469 },
  { category: 'total', tier: 4, group: 'Totals sharp money', trend: 'Totals sharp-gap season percentile 60–80%', side: 'Under', n: 445, rate: 54.83, p: 0.04636 },
  { category: 'total', tier: 4, group: 'Totals context', trend: 'Outdoor game', side: 'Under', n: 1505, rate: 52.43, p: 0.063426 },

  // ─── Referee leans ──────────────────────────────────────────────────
  { category: 'referee', tier: 5, group: 'Referee', trend: 'John Hussey refereeing crew', side: 'Home team', n: 130, rate: 60, p: 0.027945 },
  { category: 'referee', tier: 5, group: 'Referee', trend: 'Scott Novak refereeing crew', side: 'Away team', n: 110, rate: 59.09, p: 0.069565 },
  { category: 'referee', tier: 5, group: 'Referee', trend: 'Bill Vinovich refereeing crew', side: 'Away team', n: 133, rate: 57.14, p: 0.11824 },
  { category: 'referee', tier: 5, group: 'Referee', trend: 'Alan Eck refereeing crew', side: 'Home team', n: 50, rate: 58, p: 0.322236 },
  { category: 'referee', tier: 5, group: 'Referee', trend: 'Carl Cheffers refereeing crew', side: 'Home team', n: 130, rate: 53.08, p: 0.53942 }
];

// Get trends — requires a valid member session token (same gate as picks).
//
// Read-only by design: the TRENDS array above is the single source of truth. Trends only
// change when the verified workbook is regenerated, which is already a code change and a
// deploy — so there is no runtime copy to keep in sync and nothing to import by hand.
app.get('/api/trends', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const isAdmin = authHeader === 'Bearer admin-authenticated';

    // Member sessions live in Redis; without it only the admin token gets through (local dev).
    let email = 'admin';
    if (!isAdmin) {
      if (!process.env.REDIS_URL) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const client = await getRedisClient();
      email = await client.get(`session:${token}`);
      if (!email) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    }

    console.log('Trends requested by', email, '— returning', TRENDS.length, 'trends');
    res.json(TRENDS.map((t, i) => ({ id: `trend-${i}`, ...t })));
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch trends' });
  }
});

// Admin stats - Redis version
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    const emails = await getAllEmailsFromRedis();
    const customers = await getAllCustomersFromRedis();
    
    const client = await getRedisClient();
    const pickIds = await client.sMembers('all_picks');

    const totalRevenue = parseFloat(await client.get('total_revenue') || '0');
    const allPurchaseIds = await client.sMembers('all_purchases');

    const stats = {
      totalUsers: emails.length + customers.length,
      emailSignups: emails.length,
      paidSubscribers: customers.length,
      totalPicks: pickIds.length,
      totalPurchases: allPurchaseIds.length,
      totalRevenue: totalRevenue.toFixed(2),
      overallWinRate: 61
    };
    
    console.log('Stats requested:', stats);
    res.json(stats);
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get users - Redis version
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const emails = await getAllEmailsFromRedis();
    const customers = await getAllCustomersFromRedis();
    const allUsers = [...emails, ...customers];
    
    console.log('Users requested, returning', allUsers.length, 'users from Redis');
    res.json(allUsers);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Export users as CSV - Redis version (enhanced)
app.get('/api/export/users', requireAuth, async (req, res) => {
  try {
    const emails = await getAllEmailsFromRedis();
    const customers = await getAllCustomersFromRedis();
    const allUsers = [...emails, ...customers];
    
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const csvHeader = 'Email,Name,Signup Date,Type,Package Type,Status,Total Purchases,Total Spent\n';
    const csvRows = await Promise.all(allUsers.map(async (user) => {
      const email = user.email || '';
      const name = (user.name || '').replace(/,/g, ';');
      const date = user.signupDate || user.date || '';
      const type = user.type || 'email_signup';
      const packageType = user.packageType || '';
      const status = user.status || 'active';
      let purchaseCount = 0;
      let totalSpent = '0.00';
      if (type === 'paid_subscriber') {
        const purchases = await getPurchasesByEmail(email);
        purchaseCount = purchases.length;
        totalSpent = purchases.reduce((sum, p) => sum + (p.amount || 0), 0).toFixed(2);
      }
      return `"${email}","${name}","${date}","${type}","${packageType}","${status}","${purchaseCount}","${totalSpent}"`;
    }));
    const csvContent = csvHeader + csvRows.join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=yardlineiq-backup-${timestamp}.csv`);
    res.send(csvContent);
    
    console.log(`Data export completed: ${allUsers.length} users exported to CSV`);
  } catch (error) {
    console.error('Error exporting users:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Export emails only - separate endpoint for email signups specifically
app.get('/api/export/emails', requireAuth, async (req, res) => {
  try {
    const emails = await getAllEmailsFromRedis();
    
    const timestamp = new Date().toISOString().split('T')[0];
    const csvHeader = 'Email,Signup Date,Type\n';
    const csvRows = emails.map(user => {
      const email = user.email || '';
      const date = user.signupDate || user.date || '';
      const type = user.type || 'free_pick';
      
      return `"${email}","${date}","${type}"`;
    }).join('\n');
    
    const csvContent = csvHeader + csvRows;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=yardlineiq-emails-${timestamp}.csv`);
    res.send(csvContent);
    
    console.log(`Email export completed: ${emails.length} emails exported to CSV`);
  } catch (error) {
    console.error('Error exporting emails:', error);
    res.status(500).json({ error: 'Email export failed' });
  }
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve picks page for members
app.get('/picks.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'picks.html'));
});

// Serve trends page for members
app.get('/trends.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'trends.html'));
});

app.get('/handle.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'handle.html'));
});

app.get('/resources.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'resources.html'));
});

app.get('/kelly-calculator.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'kelly-calculator.html'));
});

app.get('/vig-calculator.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vig-calculator.html'));
});

app.get('/hedge-calculator.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hedge-calculator.html'));
});

app.get('/parlay-calculator.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'parlay-calculator.html'));
});

// Strategy guides
app.get('/value-betting.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'value-betting.html'));
});

app.get('/line-shopping.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'line-shopping.html'));
});

app.get('/vig-juice.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'vig-juice.html'));
});

app.get('/fixed-unit-vs-kelly.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fixed-unit-vs-kelly.html'));
});

app.get('/closing-line-value.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'closing-line-value.html'));
});

app.get('/middling-arbitrage.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'middling-arbitrage.html'));
});

app.get('/hedging.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hedging.html'));
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('YardlineIQ server running on port', PORT);
  console.log('Stripe configured:', !!process.env.STRIPE_SECRET_KEY);
  console.log('Redis email system enabled');
  console.log('Admin password:', ADMIN_PASSWORD);
});

module.exports = app;
