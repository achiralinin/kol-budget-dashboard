# KOL Budget Dashboard

แดชบอร์ดสำหรับติดตามงบ KOL — ดึงข้อมูลสด ๆ จาก Google Sheet ทุกครั้งที่โหลดหน้า

## วิธีเปิดดูแบบ local

1. เปิด terminal ที่โฟลเดอร์นี้
2. รัน server ง่าย ๆ (เลือกอย่างใดอย่างหนึ่ง)
   ```bash
   python3 -m http.server 8000
   # หรือ
   npx serve
   ```
3. เปิด http://localhost:8000

> ⚠️ ห้ามเปิดด้วย `file://` ตรง ๆ เพราะ browser จะ block fetch CSV

## ตั้งค่า Google Sheet

1. เปิด sheet → กด **Share**
2. ตั้งเป็น **Anyone with the link** → **Viewer**
3. ถ้าเปลี่ยน sheet ใหม่ ให้แก้ค่าในไฟล์ `app.js`:
   ```js
   const SHEET_ID = "...";  // จาก URL ส่วน /d/{ID}/
   const GID = "0";          // จาก URL ส่วน gid=
   ```

## Deploy ผ่าน GitHub Pages

```bash
cd /Users/kj/kol-dashboard
git init
git add .
git commit -m "init kol dashboard"

# สร้าง repo ที่ GitHub แล้วรัน:
git remote add origin https://github.com/<USER>/<REPO>.git
git branch -M main
git push -u origin main
```

จากนั้น:
1. ไปที่ repo บน GitHub → **Settings** → **Pages**
2. **Source**: Deploy from a branch
3. **Branch**: `main` / `/ (root)`
4. กด **Save** → รอ ~1 นาที จะได้ลิงก์ `https://<USER>.github.io/<REPO>/`

## โครงสร้างไฟล์

- `index.html` — โครง layout + Chart.js (CDN)
- `app.js` — fetch CSV, parse, คำนวณสถิติ, render
- `styles.css` — styling

## หมายเหตุเรื่องการ parse

Sheet มี 2 ตารางในแท็บเดียว:
- **ตาราง 1**: KOL ปกติ (จ่ายปกติ)
- **ตาราง 2**: KOL ที่มี Post Date + เครดิต 60 วัน

ตัว parser จะตรวจจับหัวตารางจากแถวที่ขึ้นต้นด้วย `#` แล้วแยก parse ตามคอลัมน์ของตารางนั้น ๆ ถ้ามีการแก้ structure ของ sheet ให้คอลัมน์ชื่อตรงกับเดิม:

- `#`, `KOLs`, `บุคคล/บริษัท`, `Budget`, `DATE (เบิก)`, `DATE (วันจ่าย)`, `Status`
- ตารางที่มีเครดิตเทอม: เพิ่มคอลัมน์ `Post Date` ด้วย

วันครบกำหนดคำนวณจาก:
1. ใช้ `DATE (วันจ่าย)` ถ้ามี
2. ถ้าไม่มี ใช้ `Post Date + 60 วัน`

สถานะ "จ่ายแล้ว" ตรวจจากคอลัมน์ Status ว่ามีคำว่า "จ่ายแล้ว" หรือไม่
