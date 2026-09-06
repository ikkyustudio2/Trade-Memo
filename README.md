# 📓 Trade Memo

ไดอารี่บันทึกการเทรดแบบวันต่อวัน — วางแผนก่อนเทรด จดออเดอร์ ดูสถิติ และสำรองขึ้น Google Drive
ใช้ได้ทั้งคอมและมือถือ ไม่มีค่าใช้จ่าย (ยกเว้นถ้าเลือกใช้ Claude AI อ่านภาพ)

## เปิดใช้งาน

**บนคอม** — ดับเบิลคลิก `run.bat` (หรือ `python serve.py`) แล้วเปิด http://localhost:8765

**บนมือถือ / นอกบ้าน** — อัปโหลดโฟลเดอร์นี้ขึ้นโฮสต์ฟรีที่รองรับไฟล์ static เช่น
GitHub Pages, Netlify Drop, Cloudflare Pages แล้วเปิด URL นั้นในมือถือ
กด **Add to Home Screen** จะได้ไอคอนเหมือนแอพ และเปิดออฟไลน์ได้ (PWA)

> ต้องเปิดผ่าน `http://` หรือ `https://` เท่านั้น (ไม่ใช่ `file://`) เพราะ Google Drive ต้องการ origin

## ใช้ยังไง

| หน้า | ทำอะไร |
|---|---|
| **ไดอารี่** | เลือกวัน → จดแผน (bias, setup, เงื่อนไข, ความเสี่ยง) + แนบรูปกราฟ → บันทึกออเดอร์ → สรุปหลังเทรด |
| **สรุปผล** | เลือก วัน / สัปดาห์ / เดือน / ปี / ทั้งหมด → winrate, กำไรสุทธิ, profit factor, expectancy, drawdown, กราฟกำไรสะสม, ปฏิทิน, แยกตามคู่เงิน / ฝั่ง / วัน |
| **ตั้งค่า** | สกุลเงิน, Google Drive, Claude API key, สำรอง/นำเข้าไฟล์ |

**แคปหน้าจอ MT5 แล้วให้แอพจดให้** — กด `📷 อ่านจาก MT5` (หรือ Ctrl+V วางรูปในหน้าไดอารี่)
- **Claude AI** — แม่นสุด อ่านได้ทั้งหน้า History มือถือและคอม ต้องใส่ API key (จ่ายตามใช้ ภาพละไม่กี่สตางค์)
- **OCR ฟรี** — Tesseract.js ทำงานในเบราว์เซอร์ ไม่ต้องใส่อะไร แต่ต้องตรวจตัวเลขก่อนกดเพิ่ม

ทุกรายการที่อ่านได้จะโชว์ให้เลือก/ตรวจก่อน แล้วค่อยเพิ่มเข้าวันนั้น (ถ้าในภาพมีวันที่ จะจัดเข้าวันให้อัตโนมัติ)

## Google Drive (ฟรี)

ทำครั้งเดียว:
1. https://console.cloud.google.com → สร้างโปรเจกต์
2. APIs & Services → Library → เปิด **Google Drive API**
3. OAuth consent screen → External → ใส่ชื่อแอพ + อีเมล → เพิ่มตัวเองใน **Test users**
4. Credentials → Create credentials → **OAuth client ID** → Web application
5. Authorized JavaScript origins ใส่ `http://localhost:8765` และ URL ที่โฮสต์ไว้ (ถ้ามี)
6. เอา Client ID ไปวางในหน้าตั้งค่า → กด ☁️ ซิงค์

แอพขอสิทธิ์แค่ `drive.file` (เห็นเฉพาะไฟล์ที่แอพสร้างเอง) ข้อมูลอยู่ในโฟลเดอร์ `Trade Memo/` บน Drive ของคุณ
ซิงค์ = ดึงของใหม่จาก Drive มารวม แล้วส่งของในเครื่องขึ้นไป ใช้หลายเครื่องได้

## โครงสร้าง

```
index.html      หน้าหลัก
css/style.css   ธีม (Mitr font, dark, responsive)
js/app.js       UI ทั้งหมด (ไดอารี่ / สรุปผล / ตั้งค่า)
js/db.js        IndexedDB (days, images, settings)
js/stats.js     คำนวณ winrate, profit factor, ฯลฯ
js/charts.js    กราฟ SVG (equity, bars, ปฏิทิน, donut)
js/ai.js        เรียก Claude อ่านภาพ MT5 (structured output)
js/ocr.js       Tesseract.js + parser สำรอง
js/drive.js     Google Identity + Drive REST v3
sw.js           service worker (ออฟไลน์)
serve.py        เซิร์ฟเวอร์เล็กๆ สำหรับเปิดบนคอม
```

ข้อมูลทั้งหมดเก็บในเบราว์เซอร์ (IndexedDB) ของแต่ละเครื่อง — ไม่มีเซิร์ฟเวอร์กลาง
API key ของ Claude เก็บในเครื่องเท่านั้น ไม่ถูกส่งขึ้น Drive
