# Kızıl Çağ çevrimiçi sunucusu

Liderlik tablosu (Kule katı ve en yüksek dalga) ve oyuncular arası eşya takası için küçük bir sunucu.
Bağımlılığı yoktur: yalnızca **Node 18 veya üstü** gerekir (`npm install` yok).

```
cd server
node server.js            # varsayılan: 0.0.0.0:8787
```

| Ortam değişkeni | Anlamı |
|---|---|
| `PORT` | Dinlenecek port (varsayılan 8787) |
| `HOST` | Dinlenecek adres (varsayılan 0.0.0.0) |
| `DATA_FILE` | Oyuncu/skor dosyası (varsayılan `server/data.json`; düzenli yedekleyin) |
| `TRUST_PROXY=1` | Nginx/Caddy arkasındaysanız gerçek IP'yi `X-Forwarded-For`'dan alır (hız sınırı için şart) |

## Yayına alma (öneri)
1. Küçük bir VPS (1 vCPU / 512 MB yeter) ya da Node çalıştıran bir PaaS.
2. **HTTPS şart** (Steam sürümünde düz HTTP kullanmayın). Caddy ile en kolayı:
   ```
   kizil.siteniz.com {
       reverse_proxy 127.0.0.1:8787
   }
   ```
   ve sunucuyu `TRUST_PROXY=1 node server.js` ile başlatın; `systemd` ya da `pm2` ile sürekli çalıştırın.
3. Oyunda adresi iki yoldan verin: oyuncu **Çevrimiçi** penceresine yazar, ya da `index.html` içindeki `ONL_DEFAULT_URL` sabitine `'https://kizil.siteniz.com'` yazarsanız herkes hazır adresle açılır (Steam sürümü için önerilir).

## API (hepsi JSON, CORS açık)
- `POST /api/register {name}` → `{id, token}` · `POST /api/rename` · `POST /api/score {id,token,tower,wave}` · `GET /api/leaderboard?board=tower|wave&id=`
- Takas: `POST /api/trade/create | join | state | offer | confirm | cancel`

## Güvenlik modeli — neleri korur, neleri korumaz
Korur:
- Belirteçler sunucuda yalnızca SHA-256 özeti olarak saklanır; yanlış belirteç reddedilir.
- Her istek doğrulanır (ad, eşya biçimi, değer sınırları, ≤6 eşya, ≤16 KB gövde), IP başına dakikada 300 istek ve saatte 10 kayıt sınırı vardır.
- Takasta **iki taraf da onaylamadan hiçbir şey el değiştirmez**; teklif değişince iki onay da sıfırlanır; onay, görülen teklif sürümüne bağlıdır (kayan teklif hilesi engellenir).
- İstemci, aynı takası iki kez uygulamaz; çanta sınırını (50) aşmaz; sunucudan gelen eşyayı doğrular; teklif edilen eşya takas sürerken satılamaz/kuşanılamaz.

**Korumaz (bilinçli seçim: "karşılıklı onay" modeli):**
- Oyun istemcide çalışır ve kayıt dosyası oyuncuda durur. Kaydı düzenleyen biri kendi çantasında eşya uydurup takas edebilir; skorunu da sahte gönderebilir (sunucu yalnızca makul sınırlara bakar). Liderlik tablosu bu yüzden "eğlence" düzeyindedir.
- Gerçek dürüstlük için eşyaların sunucuda tutulduğu hesap sistemi gerekir (çok daha büyük bir iş).
- Küfür/uygunsuz ad filtresi yoktur; sadece karakter kısıtlaması vardır. İhtiyaç olursa `cleanName` içine bir yasaklı kelime listesi eklenebilir.
- Takas odası ve oturum bilgisi bellektedir; sunucu yeniden başlarsa açık takaslar iptal olur (skorlar dosyada kalır).

Bu nedenle oyunda takas ekranında "yalnızca tanıdığınız kişilerle takas edin" uyarısı gösterilir.
