const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const Heap = require('heap');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// In-memory SQLite database
const db = new sqlite3.Database(':memory:');

// In-memory data structures
let banks = {};
let graph = {};

// Initialize database tables
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('CREATE TABLE banks (BIC TEXT PRIMARY KEY, Charge REAL)', (err) => {
                if (err) reject(err);
            });
            db.run('CREATE TABLE links (FromBIC TEXT, ToBIC TEXT, TimeTakenInMinutes INTEGER)', (err) => {
                if (err) reject(err);
            });
        });
        resolve();
    });
}

// Load data from CSV files into the database
async function loadDataToDatabase() {
    await new Promise((resolve, reject) => {
        fs.createReadStream('banks.csv')
            .pipe(csv())
            .on('data', (row) => {
                db.run('INSERT INTO banks (BIC, Charge) VALUES (?, ?)', [row.BIC, parseFloat(row.Charge)]);
            })
            .on('end', resolve)
            .on('error', reject);
    });

    await new Promise((resolve, reject) => {
        fs.createReadStream('links.csv')
            .pipe(csv())
            .on('data', (row) => {
                db.run('INSERT INTO links (FromBIC, ToBIC, TimeTakenInMinutes) VALUES (?, ?, ?)', 
                    [row.FromBIC, row.ToBIC, parseInt(row.TimeTakenInMinutes)]);
            })
            .on('end', resolve)
            .on('error', reject);
    });
}

// Load data from database into memory
async function loadDataToMemory() {
    await new Promise((resolve, reject) => {
        db.all('SELECT * FROM banks', (err, rows) => {
            if (err) reject(err);
            rows.forEach(row => {
                banks[row.BIC] = row.Charge;
            });
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        db.all('SELECT * FROM links', (err, rows) => {
            if (err) reject(err);
            rows.forEach(row => {
                if (!graph[row.FromBIC]) graph[row.FromBIC] = [];
                graph[row.FromBIC].push({ to: row.ToBIC, time: row.TimeTakenInMinutes });
            });
            resolve();
        });
    });
}

// Dijkstra's algorithm for fastest path (minimizing time)
function dijkstraFastest(start, end) {
    let distances = {};
    let predecessors = {};
    let pq = new Heap((a, b) => a.distance - b.distance);
    distances[start] = 0;
    pq.push({ node: start, distance: 0 });

    while (!pq.empty()) {
        let current = pq.pop();
        if (current.node === end) break;
        if (current.distance > distances[current.node]) continue;

        for (let neighbor of graph[current.node] || []) {
            let newDist = current.distance + neighbor.time;
            if (newDist < (distances[neighbor.to] || Infinity)) {
                distances[neighbor.to] = newDist;
                predecessors[neighbor.to] = current.node;
                pq.push({ node: neighbor.to, distance: newDist });
            }
        }
    }

    if (!(end in distances)) return null;

    let path = [];
    let current = end;
    while (current !== start) {
        path.push(current);
        current = predecessors[current];
    }
    path.push(start);
    path.reverse();
    return { path, time: distances[end] };
}

// Dijkstra's algorithm for cheapest path (minimizing cost)
function dijkstraCheapest(start, end) {
    let distances = {};
    let predecessors = {};
    let pq = new Heap((a, b) => a.distance - b.distance);
    distances[start] = banks[start];
    pq.push({ node: start, distance: banks[start] });

    while (!pq.empty()) {
        let current = pq.pop();
        if (current.node === end) break;
        if (current.distance > distances[current.node]) continue;

        for (let neighbor of graph[current.node] || []) {
            let newDist = current.distance + banks[neighbor.to];
            if (newDist < (distances[neighbor.to] || Infinity)) {
                distances[neighbor.to] = newDist;
                predecessors[neighbor.to] = current.node;
                pq.push({ node: neighbor.to, distance: newDist });
            }
        }
    }

    if (!(end in distances)) return null;

    let path = [];
    let current = end;
    while (current !== start) {
        path.push(current);
        current = predecessors[current];
    }
    path.push(start);
    path.reverse();
    return { path, cost: distances[end] };
}

// API endpoint for fastest route
app.post('/api/fastestroute', (req, res) => {
    const { fromBank, toBank } = req.body;
    if (!banks[fromBank] || !banks[toBank]) {
        return res.status(400).json({ error: 'Invalid bank BIC' });
    }
    const result = dijkstraFastest(fromBank, toBank);
    if (!result) {
        return res.status(404).json({ error: 'No path found' });
    }
    const route = result.path.join(' -> ');
    res.json({ route, time: result.time });
});

// API endpoint for cheapest route
app.post('/api/cheapestroute', (req, res) => {
    const { fromBank, toBank } = req.body;
    if (!banks[fromBank] || !banks[toBank]) {
        return res.status(400).json({ error: 'Invalid bank BIC' });
    }
    const result = dijkstraCheapest(fromBank, toBank);
    if (!result) {
        return res.status(404).json({ error: 'No path found' });
    }
    const route = result.path.join(' -> ');
    res.json({ route, cost: result.cost });
});

// Start the server
async function startServer() {
    try {
        await initializeDatabase();
        await loadDataToDatabase();
        await loadDataToMemory();
        app.listen(3000, () => {
            console.log('Server started on port 3000');
        });
    } catch (err) {
        console.error('Error starting server:', err);
    }
}

startServer();