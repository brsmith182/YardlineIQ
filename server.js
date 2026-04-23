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
        subscriptionEnd = new Date('2025-02-15');
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

// Get picks — requires valid member session token
app.get('/api/picks', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const client = await getRedisClient();
    const email = await client.get(`session:${token}`);

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
