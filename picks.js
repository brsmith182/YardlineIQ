const express = require('express');
const jwt = require('jsonwebtoken');
const Pick = require('../models/Pick');
const User = require('../models/User');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-this';

// Middleware to verify token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// Get user's picks based on subscription
router.get('/user-picks', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let pickFilter = { pickType: 'free' }; // Default to free picks

    // Check subscription level
    if (user.subscription !== 'free' && user.subscriptionEnd > new Date()) {
      pickFilter = {}; // Premium users get all picks
    }

    const picks = await Pick.find(pickFilter)
      .sort({ gameTime: -1 })
      .limit(20);

    // Calculate user stats
    const totalPicks = picks.length;
    const wonPicks = picks.filter(pick => pick.result === 'win').length;
    const winRate = totalPicks > 0 ? ((wonPicks / totalPicks) * 100).toFixed(1) + '%' : '-%';

    const currentWeek = Math.ceil((new Date() - new Date(2024, 8, 5)) / (7 * 24 * 60 * 60 * 1000));
    const weeklyPicks = picks.filter(pick => pick.week === currentWeek).length;

    res.json({
      picks,
      stats: {
        totalPicks,
        winRate,
        weeklyPicks
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load picks' });
  }
});

// Get free picks (public)
router.get('/free-picks', async (req, res) => {
  try {
    const picks = await Pick.find({ pickType: 'free' })
      .sort({ gameTime: -1 })
      .limit(5);

    res.json({ picks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load free picks' });
  }
});

module.exports = router;
