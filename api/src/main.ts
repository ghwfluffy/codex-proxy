import { serve } from "@hono/node-server";
import { loadSettings } from "./config.js";
import { createDb } from "./db.js";
import { migrate } from "./migrate.js";
import { buildApp } from "./app.js";

const settings=loadSettings();
await migrate();
const db=createDb(settings);
const server=serve({fetch:buildApp(settings,db).fetch,port:settings.port});
const shutdown=()=>server.close(async()=>{await db.end();process.exit(0);});
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
