const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-this';

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Create user
    const user = new User({ email, password, firstName, lastName });
    await user.save();

    // Create token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Account created successfully!',
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        subscription: user.subscription
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Create token
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Login successful!',
      token,
      user: {
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        subscription: user.subscription
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;
