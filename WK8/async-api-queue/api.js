const express = require("express");
const { Queue } = require("bullmq");

const app = express();
app.use(express.json());

const PORT = 3000;

const jobQueue = new Queue("jobs", {
    connection: {
        host: "127.0.0.1",
        port: 6379,
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "fixed",
            delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
    },
});

// Submit a new job
app.post("/api/jobs", async (req, res) => {
    try {
        const { task } = req.body;

        if (typeof task !== "string" || !task.trim()) {
            return res.status(400).json({
                error: "A non-empty task string is required",
            });
        }

        const job = await jobQueue.add("process-task", {
            task: task.trim(),
        });

        console.log(`Job ${job.id} queued`);

        return res.status(202).json({
            jobId: job.id,
            status: "queued",
        });
    } catch (error) {
        console.error("Job submission failed:", error);
        return res.status(503).json({
            error: "Unable to queue job",
        });
    }
});

// Check job status
app.get("/api/jobs/:id", async (req, res) => {
    try {
        const job = await jobQueue.getJob(req.params.id);

        if (!job) {
            return res.status(404).json({
                error: "Job not found",
            });
        }

        const state = await job.getState();

        const statusMap = {
            waiting: "queued",
            delayed: "queued",
            "waiting-children": "queued",
            active: "processing",
            completed: "completed",
            failed: "failed",
        };

        return res.status(200).json({
            jobId: job.id,
            status: statusMap[state] || state,
            attemptsMade: job.attemptsMade,
            result: state === "completed" ? job.returnvalue : null,
            error: state === "failed" ? job.failedReason : null,
        });
    } catch (error) {
        console.error("Status lookup failed:", error);
        return res.status(500).json({
            error: "Unable to retrieve job status",
        });
    }
});

app.listen(PORT, () => {
    console.log(`API running at http://localhost:${PORT}`);
});