'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const dbPath = path.join(ROOT, 'data', 'prisma.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('✅ Base de datos limpia y lista para nuevos usuarios.');
