# Render.com ile sunucuyu yayına alma (adım adım)

Render ücretsiz planı oyun denemesi için yeterlidir. **Bilinmesi gerekenler:** (1) ücretsiz servis 15 dk istek gelmezse uyur, ilk istek 30-60 sn sürer (oyun buna 30 sn bekler); (2) ücretsiz planda disk kalıcı değildir, sunucu yeniden başlayınca **liderlik tablosu sıfırlanır** (açık takaslar zaten bellektedir). Kalıcı skor için ücretli plan + disk gerekir (adım 6).

## 1. Sunucuyu GitHub'a koyun
1. github.com'da yeni boş bir depo açın (ör. `kizil-cag-server`, **private** olabilir).
2. `kizil-widget/server/` klasörünün **içindekileri** (server.js, package.json, render.yaml, .gitignore, SERVER.md) deponun köküne yükleyin (GitHub'da "Add file → Upload files" yeterli).

## 2. Render'da servis oluşturun
1. render.com'da GitHub ile giriş yapın → **New + → Blueprint** (ya da **Web Service**).
2. Blueprint: depoyu seçin; `render.yaml` otomatik okunur → **Apply**.
   Web Service seçerseniz: Runtime **Node**, Build Command `echo no build`, Start Command `node server.js`, Instance **Free**, Health Check Path `/api/health`, Environment: `TRUST_PROXY=1`.
3. Birkaç dakika sonra servis adresi görünür: `https://kizil-cag-server-xxxx.onrender.com`

## 3. Çalıştığını doğrulayın
Tarayıcıda `https://…onrender.com/api/health` adresini açın → `{"ok":true}` görmelisiniz (ilk açılış yavaş olabilir).

## 4. Oyuna adresi verin
- `index.html` içinde `const ONL_DEFAULT_URL = '';` satırına adresi yazın: `'https://kizil-cag-server-xxxx.onrender.com'` ve oyunu yeniden paketleyin / itch.io'ya yükleyin. Böylece oyuncular adres girmeden **Çevrimiçi** penceresinde sadece ad yazıp bağlanır.
- Hızlı deneme için adresi oyunda **Çevrimiçi → Sunucu adresi** kutusuna elle de yazabilirsiniz.

## 5. itch.io (tarayıcı sürümü) notu
Sayfa HTTPS olduğu için sunucu adresi mutlaka `https://` olmalıdır (Render bunu verir). CORS sunucuda açıktır; ek ayar gerekmez.

## 6. Skorları kalıcı yapmak (isteğe bağlı, ücretli)
`render.yaml` içindeki `plan`'ı `starter` yapıp yorum satırlarındaki **disk** ve `DATA_FILE=/var/data/data.json` satırlarını açın, tekrar deploy edin (yaklaşık 7 USD/ay + disk). Alternatif: Fly.io'da ücretsiz küçük volume.

## Sorun giderme
- "Sunucuya ulaşılamadı": servis uyuyor olabilir, 1 dk bekleyip tekrar deneyin; adres `https://` ile başlamalı ve sonunda `/` olmasa da olur.
- Render panelinde **Logs** sekmesinde sunucu çıktısını görebilirsiniz.
