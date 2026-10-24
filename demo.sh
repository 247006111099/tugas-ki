#!/usr/bin/env bash
# Skrip demo curl. Jalankan setelah `npm start`:  bash demo.sh
# Gunakan ACCESS_START/ACCESS_END saat menjalankan sistem untuk mendemokan jam akses.
G=${G:-http://localhost:3000}
tok() { sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'; }
ref() { sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p'; }
req() { echo; echo ">>> $1"; shift; curl -s -w '\n[HTTP %{http_code}]\n' "$@"; }
J='Content-Type: application/json'

req "1. Login mhs1 dengan device TIDAK terdaftar (deny)" -X POST $G/auth/login -H "$J" -H 'X-Device-ID: DEV-ASING' -d '{"username":"mhs1","password":"password123"}'
L=$(curl -s -X POST $G/auth/login -H "$J" -H 'X-Device-ID: DEV-MHS-01' -d '{"username":"mhs1","password":"password123"}')
MHS=$(echo "$L" | tok); MHS_R=$(echo "$L" | ref)
D=$(curl -s -X POST $G/auth/login -H "$J" -H 'X-Device-ID: DEV-DOSEN-01' -d '{"username":"dosen1","password":"password123"}'); DOS=$(echo "$D" | tok)
A=$(curl -s -X POST $G/auth/login -H "$J" -H 'X-Device-ID: DEV-ADMIN-01' -d '{"username":"admin1","password":"password123"}'); ADM=$(echo "$A" | tok)

req "2. Tanpa token (deny 401)" $G/nilai -H 'X-Device-ID: DEV-MHS-01'
req "3. mhs1 lihat nilai sendiri (allow)" $G/nilai -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'
req "4. mhs1 token valid, device milik orang lain (deny)" $G/nilai -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-02'
req "5. mhs1 lihat nilai mhs2 (deny)" "$G/nilai?nim=217006002" -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'
req "6. mhs1 lihat transkrip sendiri (allow)" $G/transkrip/217006001 -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'
req "7. mhs1 lihat transkrip mhs2 (deny)" $G/transkrip/217006002 -H "Authorization: Bearer $MHS" -H 'X-Device-ID: DEV-MHS-01'
req "8. dosen1 lihat kelas 2 milik dosen2 (deny)" "$G/nilai?kelas_id=2" -H "Authorization: Bearer $DOS" -H 'X-Device-ID: DEV-DOSEN-01'
req "9. dosen1 ubah nilai id 1 (allow jika dalam jam akses)" -X PUT $G/nilai/1 -H "$J" -H "Authorization: Bearer $DOS" -H 'X-Device-ID: DEV-DOSEN-01' -d '{"nilai":92}'
req "10. dosen1 ubah nilai id 4 milik kelas dosen2 (deny)" -X PUT $G/nilai/4 -H "$J" -H "Authorization: Bearer $DOS" -H 'X-Device-ID: DEV-DOSEN-01' -d '{"nilai":99}'
req "11. dosen1 finalisasi kelas 1 (allow -> sinkron transkrip)" -X POST $G/kelas/1/finalisasi -H "Authorization: Bearer $DOS" -H 'X-Device-ID: DEV-DOSEN-01'
req "12. dosen1 ubah nilai setelah final (deny 409)" -X PUT $G/nilai/1 -H "$J" -H "Authorization: Bearer $DOS" -H 'X-Device-ID: DEV-DOSEN-01' -d '{"nilai":50}'
req "13. admin lihat transkrip mhs1 (allow)" $G/transkrip/217006001 -H "Authorization: Bearer $ADM" -H 'X-Device-ID: DEV-ADMIN-01'
req "14. user mencoba POST /transkrip/sinkron (deny)" -X POST $G/transkrip/sinkron -H "$J" -H "Authorization: Bearer $DOS" -H 'X-Device-ID: DEV-DOSEN-01' -d '{}'
req "15. akses langsung ke Service Nilai :3001 (deny, tanpa gateway secret)" http://localhost:3001/nilai
req "16. refresh token" -X POST $G/auth/refresh -H "$J" -d "{\"refresh_token\":\"$MHS_R\"}"
req "17. logout (cabut refresh token)" -X POST $G/auth/logout -H "$J" -d "{\"refresh_token\":\"$MHS_R\"}"
req "18. refresh setelah logout (deny)" -X POST $G/auth/refresh -H "$J" -d "{\"refresh_token\":\"$MHS_R\"}"
echo; echo "Audit log terakhir: npm run audit"
