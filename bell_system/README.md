# OIS School Bell — 1-bosqich (jadval asosidagi avtomatik zvonok)

Bu — Oxford International School uchun quriladigan yangi qo'ng'iroq tizimining
birinchi, mustaqil ishlaydigan qismi: **jadval bo'yicha avtomatik zvonok**.
SIP / telefon orqali jonli e'lon qilish qismi bundan alohida, keyingi bosqichda
qo'shiladi va bu dasturga umuman aralashmaydi.

## Papka tuzilishi

```
bell_system/
  bell_scheduler.py     - asosiy dastur, doim ishlab turadi, jadval bo'yicha zvonok chaladi
  bell_admin.py         - jadvalni boshqarish uchun buyruq qatori vositasi
  config/
    schedule.json        - barcha qo'ng'iroqlar shu yerda: vaqt, hafta kunlari, ovoz, takrorlanish
  audios/
    (mp3 fayllar shu yerga qo'yiladi - O'QING.txt ichida batafsil)
  logs/
    bell_log.csv          - dastur avtomatik yozadigan jurnal (nima, qachon chalingani)
```

## O'rnatish (bitta martalik)

1. Kompyuteringizda **Python 3** o'rnatilgan bo'lishi kerak (windows uchun
   python.org dan yuklab olinadi, "Add to PATH" belgisini albatta bosing).
2. Terminal/CMD oching, shu papkaga o'ting:
   ```
   cd bell_system
   ```
3. Linux bo'lsa, audio pleyerlardan birini o'rnating (odatda allaqachon bor):
   ```
   sudo apt install mpg123
   ```
   Windows va macOS uchun qo'shimcha o'rnatish shart emas.

## Audio fayllarni joylashtirish

`audios/` papkasi ichidagi `O'QING.txt` faylida qaysi nomlar bilan qanday
mp3 fayllar kerakligi yozilgan. Hozircha bittasini nusxalab, boshqa nomlar
bilan ham saqlab qo'ysangiz, tizim sinov uchun ishlayveradi.

## Ishga tushirish

```
python bell_scheduler.py
```

Bu dastur **doim ochiq/ishlab turishi kerak** (kompyuter yoqilib turishi
kerak, hech bo'lmasa dars vaqtida). Uni yopsangiz, zvonok chalinmaydi.
Ctrl+C bilan to'xtatiladi.

Kelajakda buni Windows/Linux "avtomatik ishga tushirish" ro'yxatiga
qo'shib, kompyuter yonganda o'zi ishga tushadigan qilamiz — hozircha
qo'lda ishga tushirib sinab ko'rish uchun shu yetarli.

## Qo'ng'iroq qo'shish

Har bir qo'ng'iroq uchun quyidagilar belgilanadi:

- **vaqt** (HH:MM),
- **hafta kunlari** (Dushanba–Yakshanba orasidan xohlaganingiz),
- **ovoz fayli** (`audios/` papkasidan),
- **necha marta chalinishi** — ovoz shu vaqtda ketma-ket necha marta chalinadi,
- **necha hafta takrorlanishi** — bo'sh qoldirsangiz doimiy; masalan 4 desangiz,
  qo'shilgan kundan boshlab 4 hafta davomida chalinadi, keyin o'zi to'xtaydi.

Eng qulayi — `bell_web` boshqaruv paneli ("Qo'ng'iroqlar" tabi). Buyruq qatori orqali:

```
python bell_admin.py royxat
```
Barcha qo'ng'iroqlarni (ID bilan) ko'rsatadi.

```
python bell_admin.py qosh 08:25 ish dars.mp3 "1-dars" --marta 2 --hafta 4
```
08:25 da, ish kunlari (dush–juma), `dars.mp3` ni 2 marta ketma-ket chalib, 4 hafta davomida.
Kunlar: `hammasi`, `ish` yoki vergul bilan `dush,sesh,chor,pay,jum,shan,yak`.

```
python bell_admin.py ochir <ID>
```
ID bo'yicha qo'ng'iroqni o'chiradi.

Dastur ishlab turganda ham bu o'zgarishlar avtomatik kuchga kiradi.

## Jadvalni qo'lda tahrirlash

`config/schedule.json` faylini istalgan matn muharriri bilan ochib, `bells`
ro'yxatini o'zgartirish mumkin — fayl formati ichida izohlangan (`_readme` qatori).

## Jurnal

`logs/bell_log.csv` faylida har bir chalingan (yoki xato bo'lgani uchun
chalinmagan) qo'ng'iroq, sanasi va vaqti bilan avtomatik yoziladi. Excel'da
ochib ko'rish mumkin.

## Jonli e'lon (mikrofon -> speaker)

`live_announce.py` — shu kompyuterdagi mikrofondan kelayotgan ovozni real
vaqtda audio chiqishiga (speakerlarga) uzatib turadi. `bell_scheduler.py`
dan butunlay alohida ishlaydi va uni `bell_web` boshqaruv panelidagi
"Jonli e'lon" tugmasi orqali ishga tushirish/to'xtatish qulay.

O'rnatish (bir martalik):
```
pip install -r requirements.txt
```

Qo'lda sinash uchun to'g'ridan-to'g'ri ham ishga tushirish mumkin:
```
python live_announce.py
```
To'xtatish: Ctrl+C.

## Ovoz dispetcheri (ustma-ust chalinmaslik)

Karnayga chiqadigan hamma tovush `audio_engine.py` orqali o'tadi. Daraja bo'yicha:

1. **E'lon** — panelning "Hozir dinamikdan chalish"i, kutubxonadagi "E'lon" turidagi fayllar, jonli mikrofon
2. **Qo'ng'iroq** — oddiy qo'ng'iroqlar (kutubxonada turi "Qo'ng'iroq" yoki kutubxonadan tashqari fayllar)
3. **Musiqa** — kutubxonadagi "Musiqa" turidagi fayllar

Qoidalar:
- Qo'ng'iroq yoki e'lon (yoki mikrofon) paytida musiqa **15% gacha asta pasayadi** va keyin qaytadi — to'xtamaydi.
- Bir darajadagi tovushlar **navbat bilan**, birin-ketin chalinadi (ikki qo'ng'iroq bir vaqtda kelsa ham).
- Qo'ng'iroq e'lon yoki mikrofon tugashini kutadi, lekin **ko'pi bilan 2 daqiqa** — keyin baribir chalinadi.
- E'lon chalinayotgan qisqa qo'ng'iroq tugashini kutadi.

Panel (`bell_web/server.js`) dispetcherga faqat shu kompyuter ichidagi `127.0.0.1:3901` port orqali
xabar beradi (`/play`, `/stop`, `/mic`, `/status`). Qo'ng'iroq dasturi ishlamayotgan bo'lsa,
panelning "hozir chalish"i eski usulda (to'g'ridan-to'g'ri) chalinadi.

## Keyingi bosqichlar (hali qilinmagan)

- Telefon orqali jonli e'lon (SIP) — tashqi/ichki qo'ng'iroq orqali `live_announce.py` ni avtomatik ishga tushirish, hali qo'shilmagan
- Favqulodda signal tugmasi
- Panelda "hozir karnayda nima chalinmoqda" ko'rsatkichi
