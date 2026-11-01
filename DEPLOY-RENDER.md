# Render.com ile sunucuyu yayına alma (adım adım)

Render ücretsiz planı oyun denemesi için yeterlidir. **Bilinmesi gerekenler:** (1) ücretsiz servis 15 dk istek gelmezse uyur, ilk istek 30-60 sn sürer (oyun 45 sn bekler, başarısız olursa dakikada bir kendiliğinden yeniden dener); (2) ücretsiz planda disk kalıcı değildir: **Upstash Redis'i bağlamazsanız** sunucu yeniden başlayınca liderlik tablosu ve **bulut kayıtları silinir**. Bu yüzden adım 6'yı (ücretsiz) mutlaka yapın.

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
- **Masaüstü/Steam sürümü:** `online.json` dosyasını açıp `{"url": "https://kizil-cag-server-xxxx.onrender.com"}` yazın ve `exe-olustur.bat` ile paketleyin. Oyun açılınca **kendiliğinden bağlanır** (oyuncu adı otomatik: Oyuncu1234; sonradan değiştirilebilir) ve ilerleme sunucuya kaydedilir.
- **itch.io tarayıcı sürümü:** `index.html` içinde `const ONL_DEFAULT_URL = '';` satırına aynı adresi yazın.
- Hızlı deneme için adresi oyunda **Çevrimiçi → Sunucu adresi** kutusuna elle de yazabilirsiniz.

## 5. itch.io (tarayıcı sürümü) notu
Sayfa HTTPS olduğu için sunucu adresi mutlaka `https://` olmalıdır (Render bunu verir). CORS sunucuda açıktır; ek ayar gerekmez.

## 6. Verileri kalıcı yapmak — Upstash Redis (ücretsiz, önerilir)
Skorlar ve oyuncu kayıtları burada tutulur; Render uyuyup yeniden başlasa da silinmez.
1. upstash.com'da ücretsiz hesap açın → **Create Database** (Redis; bölge: Render bölgenize yakın, ör. Frankfurt) → Type: Regional.
2. Veritabanı sayfasında **REST API** bölümündeki `UPSTASH_REDIS_REST_URL` ve `UPSTASH_REDIS_REST_TOKEN` değerlerini kopyalayın.
3. Render → servisiniz → **Environment** → ikisini aynı adlarla ekleyin → **Save** (servis yeniden başlar).
4. Doğrulama: Render **Logs**'ta hata yok; oyunda bağlanıp "Buluta kaydet" deyin, sonra Render'da **Manual Deploy → Restart** yapın; liderlik tablosu ve kayıt yerinde olmalı.
Ücretsiz Upstash kotası (günlük ~10 bin komut, 256 MB) birkaç yüz oyuncu için yeterlidir; oyun kaydı oyuncu başına ~10-50 KB'dır. Sunucu skor listesini en fazla birkaç saniyede bir yazar, kayıtlar oyuncu başına en fazla 15 sn'de bir kabul edilir.
(Alternatif: ücretli plan + disk: `plan: starter`, disk bağlayıp `DATA_FILE=/var/data/data.json`.)

## 7. Oyuncular için bulut kaydı
- Oyun bağlanınca ilerlemeyi dakikada bir buluta yazar; açılışta bulut daha yeniyse (başka bilgisayarda oynandıysa) onu yükler.
- Başka bilgisayarda: **Çevrimiçi → Başka bilgisayardan bağlan** kutusuna eski bilgisayardaki **kurtarma kodunu** yapıştırın.
- **Kurtarma kodu = hesabın anahtarı**: kaybolursa hesaba erişilemez, başkasına verilirse o kişi kaydı ezebilir/indirebilir.
- İki bilgisayarda aynı anda oynarsanız en son yazan kazanır; bunu önlemek için aynı hesapla tek bilgisayarda oynayın.

## Sorun giderme
- "Sunucuya ulaşılamadı": servis uyuyor olabilir, 1 dk bekleyip tekrar deneyin; adres `https://` ile başlamalı ve sonunda `/` olmasa da olur.
- Render panelinde **Logs** sekmesinde sunucu çıktısını görebilirsiniz.
