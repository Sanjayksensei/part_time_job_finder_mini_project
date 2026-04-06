require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/init');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes (registered BEFORE static files to prevent route interception)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/applications', require('./routes/applications'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/tokens', require('./routes/tokens'));
app.use('/api/reports', require('./routes/reports'));

// Serve static files from project root (Render hosts backend + frontend together)
// Placed AFTER API routes so /api/* requests are never caught by static middleware
app.use(express.static(path.join(__dirname, '..'), { extensions: ['html', 'htm'] }));

// Default route
app.get('/', (req, res) => {
    res.redirect('/frontend/index.html');
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize database (async) then start server
async function start() {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            console.log(`\n🚀 Part Time Job Finder Server running on http://localhost:${PORT}`);
            console.log(`📄 Frontend: http://localhost:${PORT}/frontend/index.html`);
            console.log(`🔑 Login:    http://localhost:${PORT}/frontend/login.html`);
            console.log(`📊 API:      http://localhost:${PORT}/api/jobs\n`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
