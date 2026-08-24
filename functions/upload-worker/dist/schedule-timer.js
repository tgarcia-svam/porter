"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
/**
 * Daily timer that drives the per-project upload-schedule notifications. It POSTs
 * to the Next.js app's /api/admin/schedules/run using the shared worker secret
 * (the same dual-auth pattern as the retention job). All schedule evaluation and
 * email sending happens app-side; this function is just the clock.
 *
 * Runs at 08:30 America/New_York daily (WEBSITE_TIME_ZONE set in Bicep handles
 * DST automatically). The endpoint is idempotent (ScheduleNotification ledger),
 * so an occasional double-fire or catch-up run sends nothing extra.
 */
functions_1.app.timer("scheduleChecker", {
    schedule: "0 30 8 * * *", // NCRONTAB: sec min hour day month day-of-week
    handler: async (_timer, context) => {
        const appUrl = process.env.APP_URL;
        const workerSecret = process.env.UPLOAD_WORKER_SECRET;
        if (!appUrl || !workerSecret) {
            throw new Error("APP_URL or UPLOAD_WORKER_SECRET is not configured");
        }
        const url = `${appUrl.replace(/\/$/, "")}/api/admin/schedules/run`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "x-worker-secret": workerSecret },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "(no body)");
            throw new Error(`/api/admin/schedules/run responded ${res.status}: ${body}`);
        }
        const sanitize = (v) => String(v ?? "").replace(/[\r\n\t]/g, " ");
        const result = await res.json().catch(() => ({}));
        context.log(`Schedule run complete: checked=${sanitize(result.schedulesChecked)} reminders=${sanitize(result.remindersSent)} overdue=${sanitize(result.overdueSent)}`);
    },
});
