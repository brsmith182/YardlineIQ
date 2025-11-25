const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('redis');
const router = express.Router();

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

// Create payment intent - basic version that works
router.post('/create-payment-intent', async (req, res) => {
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

// Handle successful payment - saves to Redis
router.post('/payment-success', async (req, res) => {
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
        id: Date.now(), // Simple ID
        name: customerInfo.name,
        email: customerInfo.email,
        packageType: packageType,
        purchaseDate: new Date(),
        subscriptionEnd: subscriptionEnd,
        paymentId: paymentIntentId,
        status: 'active'
      };
      
      // Save customer to Redis
      try {
        const client = await getRedisClient();
        await client.set(`customer:${customerInfo.email}`, JSON.stringify(customer));
        await client.sAdd('all_customers', customerInfo.email);
        console.log('Customer saved to Redis:', customer);
      } catch (redisError) {
        console.error('Redis save error:', redisError);
        // Still send success response even if Redis fails
      }
      
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

// Get customers for admin dashboard
router.get('/customers', async (req, res) => {
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

    res.json({ customers: customers.reverse() }); // Show newest first
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const client = await getRedisClient();
    const customerCount = await client.sCard('all_customers');
    
    res.json({
      totalUsers: customerCount,
      paidSubscribers: customerCount,
      totalPicks: 0,
      emailSignups: 0,
      winRate: 61
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
