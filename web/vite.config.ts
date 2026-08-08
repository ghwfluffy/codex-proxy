import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({ plugins:[vue()], base: process.env.VITE_APP_BASE_PATH ? `${process.env.VITE_APP_BASE_PATH.replace(/\/$/,"")}/` : "/", test:{environment:"jsdom"} });
