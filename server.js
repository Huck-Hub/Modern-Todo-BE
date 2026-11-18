var express = require("express");
var cors = require("cors");
var path = require("path");
var fs = require("fs");
require("dotenv").config({ path: "./config.env" });

// Native MongoDB driver setup
const { MongoClient, ObjectId } = require("mongodb");
const hasAtlasConfig = process.env.MONGODB_USERNAME && process.env.MONGODB_USERNAME !== "your_username";
const uri = process.env.MONGODB_PREFIX +
    process.env.MONGODB_USERNAME + ":" +
    process.env.MONGODB_PASSWORD +
    process.env.MONGODB_URL;
const client = hasAtlasConfig ? new MongoClient(uri) : null;
const db = client ? client.db(process.env.MONGODB_DB || "ModernTodoDB") : null;

// Load local fallback tasks from tasks.json so the server works immediately out of the box
let localTasks = JSON.parse(fs.readFileSync(path.resolve(__dirname, "tasks.json"), "utf8"));

var app = express();

app.use(cors());
app.use(express.json());

// Logger Middleware: logs every incoming request's HTTP method, URL, and timestamp
app.use(function(request, response, next) {
    console.log("Incoming " + request.method + " request to " + request.url + " [" + new Date().toISOString() + "]");
    next();
});

// Static File Middleware
var publicPath = path.resolve(__dirname, "staticFiles");
app.use("/images", express.static(publicPath));
app.use("/images", function(request, response) {
    response.status(404).send("Image not found!");
});

// Helper to get all tasks from MongoDB Atlas (or local fallback)
async function getAllTasks() {
    if (db) {
        let collection = await db.collection("tasks");
        return await collection.find({}).toArray();
    }
    return localTasks;
}

// GET /tasks: returns all tasks as JSON
app.get("/tasks", async function(request, response) {
    try {
        let results = await getAllTasks();
        response.send(results);
    } catch (err) {
        response.send(localTasks);
    }
});

// GET /search?q=...: full-stack search across title, category, priorityLabel, status, and dueDate
app.get("/search", async function(request, response) {
    let searchText = (request.query.q || "").toLowerCase();
    try {
        let allTasks = await getAllTasks();
        let filtered = allTasks.filter(function(task) {
            return String(task.title).toLowerCase().includes(searchText) ||
                   String(task.category).toLowerCase().includes(searchText) ||
                   String(task.priorityLabel).toLowerCase().includes(searchText) ||
                   String(task.status).toLowerCase().includes(searchText) ||
                   String(task.dueDate).toLowerCase().includes(searchText);
        });
        response.send(filtered);
    } catch (err) {
        response.status(500).send({ error: "Search failed" });
    }
});

// POST /tasks: saves a new task to MongoDB Atlas (and local fallback)
app.post("/tasks", async function(request, response) {
    var body = request.body;
    try {
        if (db) {
            let collection = await db.collection("tasks");
            let result = await collection.insertOne(body);
            response.send(result);
        } else {
            body._id = String(Date.now());
            localTasks.unshift(body);
            response.send({ acknowledged: true, insertedId: body._id });
        }
    } catch (err) {
        response.status(500).send({ error: "Failed to save task" });
    }
});

// PUT /tasks/:_id: updates any attribute of a task (title, priority, dueDate, completed, status, subtasks)
app.put("/tasks/:_id", async function(request, response) {
    let tempid = request.params._id;
    try {
        if (db && ObjectId.isValid(tempid)) {
            let collection = await db.collection("tasks");
            const query = { _id: new ObjectId(tempid) };
            const updates = { $set: request.body };
            let result = await collection.updateOne(query, updates);
            response.send(result);
        } else {
            for (let i = 0; i < localTasks.length; i++) {
                if (String(localTasks[i]._id) === String(tempid) || String(localTasks[i].id) === String(tempid)) {
                    Object.assign(localTasks[i], request.body);
                }
            }
            response.send({ acknowledged: true, modifiedCount: 1 });
        }
    } catch (err) {
        response.status(500).send({ error: "Failed to update task" });
    }
});

// DELETE /tasks/completed: bulk-deletes all completed tasks
app.delete("/tasks/completed", async function(request, response) {
    try {
        if (db) {
            let collection = await db.collection("tasks");
            let result = await collection.deleteMany({ completed: true });
            response.send(result);
        } else {
            localTasks = localTasks.filter(function(t) { return !t.completed; });
            response.send({ acknowledged: true });
        }
    } catch (err) {
        response.status(500).send({ error: "Failed to clear completed tasks" });
    }
});

// DELETE /tasks/:_id: deletes a single task from MongoDB Atlas (or local fallback)
app.delete("/tasks/:_id", async function(request, response) {
    let tempid = request.params._id;
    try {
        if (db && ObjectId.isValid(tempid)) {
            let collection = await db.collection("tasks");
            const query = { _id: new ObjectId(tempid) };
            let result = await collection.deleteOne(query);
            response.send(result);
        } else {
            localTasks = localTasks.filter(function(t) {
                return String(t._id) !== String(tempid) && String(t.id) !== String(tempid);
            });
            response.send({ acknowledged: true, deletedCount: 1 });
        }
    } catch (err) {
        response.status(500).send({ error: "Failed to delete task" });
    }
});

// Final 404 Fallback Middleware
app.use(function(request, response) {
    response.status(404).send("Page not found!");
});

const port = process.env.PORT || 3000;
app.listen(port, function() {
    console.log("Modern Todo Backend Server started on port " + port);
});
