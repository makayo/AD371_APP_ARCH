const { Worker } = require("bullmq");

const worker = new Worker(
    "jobs",
    async (job) => {
        console.log(`Processing job ${job.id}: ${job.data.task}`);

        // Controlled failure for QA retry testing
        if (job.data.task === "TEST_RETRY_FAILURE") {
            console.log(`Simulated failure for job ${job.id}`);
            throw new Error("Intentional QA test failure");
        }

        // Simulate 5 seconds of background processing
        await new Promise((resolve) => setTimeout(resolve, 5000));

        console.log(`Finished processing job ${job.id}`);

        return {
            message: "Task completed successfully",
            task: job.data.task,
        };
    },
    {
        connection: {
            host: "127.0.0.1",
            port: 6379,
        },
        concurrency: 1,
    }
);

worker.on("completed", (job) => {
    console.log(`COMPLETED: Job ${job.id} (BullMQ-managed acknowledgment)`);
});

worker.on("failed", (job, error) => {
    console.error(`Job ${job?.id} failed: ${error.message}`);
});

worker.on("error", (error) => {
    console.error("Worker error:", error);
});

console.log("Background worker started. Waiting for jobs...");