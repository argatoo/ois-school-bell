# Maktab qo'ng'iroq tizimi — 1-bosqich (jadval asosidagi avtomatik zvonok)

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
    schedule.json        - barcha sozlamalar shu yerda: vaqtlar, kun turlari, haftalik jadval
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

## Jadvalni boshqarish (bell_admin.py)

Dastur ishlab turgan payt, boshqa terminal oynasida quyidagi buyruqlarni
ishlatib jadvalni o'zgartirasiz — o'zgarish avtomatik kuchga kiradi,
scheduler'ni qayta ishga tushirish shart emas:

```
python bell_admin.py holat
```
Bugungi kun qaysi jadval bo'yicha ishlayotganini va barcha signallarni ko'rsatadi.

```
python bell_admin.py turlar
```
Mavjud barcha kun turlarini (oddiy, qisqartirilgan, imtihon, bayram_oldi) ko'rsatadi.

```
python bell_admin.py belgila 2026-09-25 qisqartirilgan
```
25-sentabr kunini "qisqartirilgan kun" sifatida belgilaydi (faqat o'sha kunga).

```
python bell_admin.py bekor 2026-09-25
```
Yuqoridagi maxsus belgilashni bekor qiladi, kun yana oddiy haftalik jadvalga qaytadi.

```
python bell_admin.py hafta sunday oddiy
```
Doimiy haftalik jadvalni o'zgartiradi (masalan yakshanba kunini ham "oddiy" qilib qo'yish).
`bosh` so'zini yozsangiz ("hafta sunday bosh"), o'sha kun umuman zvonoksiz bo'lib qoladi.

## Jadvalni qo'lda tahrirlash

`config/schedule.json` faylini istalgan matn muharriri (Notepad, VS Code) bilan
ochib, vaqt/ovoz/kun turlarini xohlagancha o'zgartirish yoki yangi kun turi
qo'shish mumkin — fayl formati ichida izohlangan (`_readme` qatori).

## Jurnal

`logs/bell_log.csv` faylida har bir chalingan (yoki xato bo'lgani uchun
chalinmagan) signal, sanasi va vaqti bilan avtomatik yoziladi. Excel'da
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

## Keyingi bosqichlar (hali qilinmagan)

- Telefon orqali jonli e'lon (SIP) — tashqi/ichki qo'ng'iroq orqali `live_announce.py` ni avtomatik ishga tushirish, hali qo'shilmagan
- Favqulodda signal tugmasi
- Kompyuter yoqilganda dasturning o'zi avtomatik ishga tushishi
