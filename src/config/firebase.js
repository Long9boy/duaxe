// src/config/firebase.js
// Khởi tạo kết nối Firebase App và Realtime Database

import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
    apiKey: "AIzaSyAQhRj55WQsH0KDSx6aWbT2n-hXA-RI9ws",
    authDomain: "duaxe-31db1.firebaseapp.com",
    databaseURL: "https://duaxe-31db1-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "duaxe-31db1",
    storageBucket: "duaxe-31db1.firebasestorage.app",
    messagingSenderId: "240744892203",
    appId: "1:240744892203:web:bd63802bd6ea4005a3a76e"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
