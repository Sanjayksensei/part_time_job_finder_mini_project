const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// ── Database Connection ──
// Uses ONLY individual env vars: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    ssl: {
        rejectUnauthorized: false
    },

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000
});

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const SEED_PATH = path.join(__dirname, 'seed.sql');

async function initDatabase() {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database');

    try {
        // Check if users table exists to determine if we need to seed
        const [rows] = await connection.query("SHOW TABLES LIKE 'users'");
        const isNew = rows.length === 0;

        if (isNew) {
            console.log('🌱 Initializing schema and seeding data...');

            const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
            await connection.query(schema);

            const hash = await bcrypt.hash('password123', parseInt(process.env.BCRYPT_ROUNDS) || 10);
            let seed = fs.readFileSync(SEED_PATH, 'utf8');
            seed = seed.replace(/\$PLACEHOLDER\$/g, hash);
            await connection.query(seed);

            console.log('✅ Database seeded');
        } else {
            console.log('📦 Database already populated');
        }

        // ── Migrations ──

        // roles column on users
        try {
            const [cols] = await connection.query("SHOW COLUMNS FROM users LIKE 'roles'");
            if (cols.length === 0) {
                await connection.query("ALTER TABLE users ADD COLUMN roles VARCHAR(50) DEFAULT NULL");
                await connection.query("UPDATE users SET roles = role WHERE roles IS NULL");
            }
        } catch (_) {}


        // user_roles table
        try {
            const [t] = await connection.query("SHOW TABLES LIKE 'user_roles'");
            if (t.length === 0) {
                await connection.query(`
                    CREATE TABLE user_roles (
                        id INT PRIMARY KEY AUTO_INCREMENT,
                        user_id INT NOT NULL,
                        role ENUM('employee','employer') NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_user_role (user_id, role),
                        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
                    )
                `);
                const [allUsers] = await connection.query("SELECT user_id, role, roles FROM users");
                for (const u of allUsers) {
                    const roleList = (u.roles || u.role || '').split(',').map(r => r.trim()).filter(Boolean);
                    for (const r of roleList) {
                        if (['employee', 'employer'].includes(r)) {
                            await connection.query(
                                "INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, ?)",
                                [u.user_id, r]
                            );
                        }
                    }
                }
            }
        } catch (_) {}

        // contracts table
        try {
            const [t] = await connection.query("SHOW TABLES LIKE 'contracts'");
            if (t.length === 0) {
                await connection.query(`
                    CREATE TABLE contracts (
                        contract_id INT PRIMARY KEY AUTO_INCREMENT,
                        application_id INT UNIQUE DEFAULT NULL,
                        job_id INT NOT NULL,
                        employee_id INT NOT NULL,
                        employer_id INT NOT NULL,
                        job_mode ENUM('offline','online') DEFAULT 'offline',
                        qr_code TEXT,
                        status ENUM('active','completed','cancelled') DEFAULT 'active',
                        participation_status ENUM('active','resigned') DEFAULT 'active',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (application_id) REFERENCES applications(application_id) ON DELETE CASCADE,
                        FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE,
                        FOREIGN KEY (employee_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (employer_id) REFERENCES users(user_id) ON DELETE CASCADE
                    )
                `);
            }
        } catch (_) {}

        // attendance table
        try {
            const [t] = await connection.query("SHOW TABLES LIKE 'attendance'");
            if (t.length === 0) {
                await connection.query(`
                    CREATE TABLE attendance (
                        attendance_id INT PRIMARY KEY AUTO_INCREMENT,
                        contract_id INT NOT NULL,
                        employee_id INT NOT NULL,
                        method ENUM('qr_scan','online_confirm') DEFAULT 'qr_scan',
                        marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        date DATE NOT NULL,
                        UNIQUE KEY unique_attendance (contract_id, date),
                        FOREIGN KEY (contract_id) REFERENCES contracts(contract_id) ON DELETE CASCADE,
                        FOREIGN KEY (employee_id) REFERENCES users(user_id) ON DELETE CASCADE
                    )
                `);
            }
        } catch (_) {}

        // jobs columns: allow_resignation, qr_token, max_workers, status, dates, times
        try {
            const addIfMissing = async (table, col, def) => {
                const [c] = await connection.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
                if (c.length === 0) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
            };
            await addIfMissing('jobs', 'allow_resignation', 'BOOLEAN DEFAULT TRUE');
            await addIfMissing('jobs', 'qr_token', 'TEXT');
            await addIfMissing('jobs', 'max_workers', 'INT DEFAULT NULL');
            await addIfMissing('jobs', 'status', "ENUM('open','closed') DEFAULT 'open'");
            await addIfMissing('jobs', 'job_date', 'DATE DEFAULT NULL');
            await addIfMissing('jobs', 'end_date', 'DATE DEFAULT NULL');
            await addIfMissing('jobs', 'start_time', 'TIME DEFAULT NULL');
            await addIfMissing('jobs', 'end_time', 'TIME DEFAULT NULL');
        } catch (_) {}

        // contracts: participation_status column
        try {
            const [c] = await connection.query("SHOW COLUMNS FROM contracts LIKE 'participation_status'");
            if (c.length === 0) {
                await connection.query("ALTER TABLE contracts ADD COLUMN participation_status ENUM('active','resigned') DEFAULT 'active'");
            }
        } catch (_) {}

        // contracts: make application_id nullable
        try {
            const [cols] = await connection.query("SHOW COLUMNS FROM contracts WHERE Field = 'application_id'");
            if (cols.length > 0 && cols[0].Null === 'NO') {
                await connection.query("ALTER TABLE contracts MODIFY application_id INT UNIQUE DEFAULT NULL");
            }
        } catch (_) {}

        // job_offers table
        try {
            const [t] = await connection.query("SHOW TABLES LIKE 'job_offers'");
            if (t.length === 0) {
                await connection.query(`
                    CREATE TABLE job_offers (
                        offer_id INT PRIMARY KEY AUTO_INCREMENT,
                        employer_id INT NOT NULL,
                        employee_id INT NOT NULL,
                        job_id INT NOT NULL,
                        message TEXT,
                        status ENUM('pending','accepted','declined') DEFAULT 'pending',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        responded_at TIMESTAMP NULL,
                        UNIQUE KEY unique_offer (employer_id, employee_id, job_id),
                        FOREIGN KEY (employer_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (employee_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
                    )
                `);
            }
        } catch (_) {}

        // reports table
        try {
            const [t] = await connection.query("SHOW TABLES LIKE 'reports'");
            if (t.length === 0) {
                await connection.query(`
                    CREATE TABLE reports (
                        report_id INT PRIMARY KEY AUTO_INCREMENT,
                        reporter_id INT NOT NULL,
                        reported_id INT NOT NULL,
                        job_id INT DEFAULT NULL,
                        contract_id INT DEFAULT NULL,
                        reason VARCHAR(100) NOT NULL,
                        description TEXT,
                        status ENUM('pending','reviewed','resolved','dismissed') DEFAULT 'pending',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (reporter_id) REFERENCES users(user_id) ON DELETE CASCADE,
                        FOREIGN KEY (reported_id) REFERENCES users(user_id) ON DELETE CASCADE
                    )
                `);
            }
        } catch (_) {}

        // applications: unique constraint
        try {
            const [idx] = await connection.query("SHOW INDEX FROM applications WHERE Key_name = 'unique_job_employee'");
            if (idx.length === 0) {
                await connection.query("ALTER TABLE applications ADD UNIQUE KEY unique_job_employee (job_id, employee_id)");
            }
        } catch (_) {}

    } finally {
        connection.release();
    }

    return pool;
}

module.exports = { initDatabase, pool };
