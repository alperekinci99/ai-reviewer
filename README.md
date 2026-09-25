# Orbit — Developer Cockpit

Yerel geliştirme akışını birden fazla proje bağlamında birleştiren kişisel developer paneli. İlk sürüm; ana dashboard, agent çalıştırabilen proje bazlı sürükle-bırak workflow, günlük çalışma hafızası ve mevcut AI code review aracını içerir.

Workflow ve journal verileri tarayıcıda yerel olarak saklanır. AI modülleri kullanıcının bilgisayarında kurulu ve oturumu açık olan Codex veya Claude Code CLI üzerinden çalışır. Uygulama API anahtarı istemez, okumaz ve saklamaz. Diff, değişiklik metadatası, ilgili README ve isteğe bağlı inceleme notu seçilen yerel araca iletilir; review sonucu önceden tanımlı JSON şemasına göre doğrulanır.

## Çalıştırma

Node.js 18 veya üstü, macOS ve desteklenen yerel araçlardan en az biri gerekir: Codex CLI veya Claude Code CLI. Kullanmak istediğiniz aracın kendi oturum açma akışını önceden tamamlamış olmalısınız.

```bash
npm run dev
```

Ardından `http://localhost:3000` adresini açın. AI Review ekranındaki proje seçiciden repository yolunu yazın veya `Finder’dan seç` ile repository klasörünü seçin; ardından inceleme türünü ve commit/PR hedefini girin. Bir proje seçilene kadar review alanları kilitli kalır.

AI çalışmaları seçilen yerel aracın hesabındaki kullanım kotasından harcanır. AI Review salt-okunur modda çalışır. Workflow executor ise yalnızca seçilen repository için yazma izniyle çalışır; commit, push veya dış sisteme yazma yapmaz.

## Agent kuralları ve yerel sağlayıcılar

Her AI modülünün davranış sözleşmesi `agents/` klasöründe ayrı tutulur: `reviewer.md`, `workflow.md` ve gerçek kod değişikliğini yapan `executor.md`. Kurallar modülün amacını, izinlerini, kapsamını ve çıktı sözleşmesini tanımlar; model sağlayıcısından bağımsızdır.

Ortak sağlayıcı katmanı başlangıçta Codex ve Claude Code CLI araçlarını otomatik keşfeder. Arayüzden `Otomatik seçim`, `Codex` veya `Claude Code` seçilebilir. Otomatik seçim yalnızca kullanılabilir yerel araçlardan birini kullanır; uygulama içerisinde API token alanı veya secret saklama mekanizması bulunmaz.

### Workflow iş puanı ve model profili

Workflow görevleri kapsam için `2`, `3` veya `5` puan alır. Puan, workflow agent model profilini belirler:

- `2`: küçük ve net işler — Codex için `gpt-5.6-luna` + `low`, Claude Code için `haiku`.
- `3`: orta kapsamlı işler — Codex için `gpt-5.6-terra` + `medium`, Claude Code için `sonnet`.
- `5`: çok adımlı veya riskli işler — Codex için `gpt-5.6-sol` + `high`, Claude Code için `opus`.

Yeni görevler otomatik olarak `Yapılacak` durumunda oluşturulur ve kullanılabilir yerel LLM aracı otomatik seçilir. Puan yönlendirmesi kesin bir token üst sınırı değildir; model kapasitesi ve reasoning seviyesi üzerinden kullanım/kalite dengesini yönetir. AI Review modeli ve çaba ayarı bu puanlardan bağımsız kalır.

### Otomatik workflow çalışması ve review döngüsü

Bir görev `Yapılıyor` kolonuna taşındığında seçilen yerel Codex veya Claude Code aracı arka planda otomatik başlar. Görev tamamlandığında kart kendiliğinden `Review` kolonuna geçer; agent özeti, değişen dosyalar, Git diff'i ve çalışma sohbeti kart üzerinde gösterilir.

Review sırasında feedback gönderebilirsiniz. Feedback gönderildiği anda görev otomatik olarak `Yapılıyor` kolonuna döner; aynı sağlayıcı, model ve mümkün olduğunda aynı CLI oturumu devam ettirilerek yeni tur başlatılır. Yapılan dosya değişiklikleri kartı büyütmeden `Değişiklikleri gör` penceresinde açılır. Agent çalışırken kart taşınamaz veya silinemez. Aynı repository üzerinde aynı anda yalnızca bir workflow görevi çalıştırılır.

İlk agent turu başlamadan önce repository'nin çalışma ağacı temiz olmalıdır. Bu kontrol, kullanıcıya ait kaydedilmemiş değişikliklerin agent değişiklikleriyle karışmasını veya ezilmesini önler. İlk turdan sonra oluşan çalışma ağacı feedback turlarında aynı görev bağlamı olarak korunur.

Workflow görevlerinin kendisi tarayıcı localStorage'ında kalır. Agent çalışma kayıtları, mesajlar, session kimliği ve review diff'i kullanıcıya özel `~/.config/ai-reviewer/workflow-runs.json` dosyasına kaydedilir. Sunucu çalışma ortasında kapanırsa kayıt güvenli biçimde `failed` durumuna alınır ve görev yeniden tetiklenebilir.

Arayüzdeki model seçici Codex CLI’a `--model`, çaba seçici ise `model_reasoning_effort` yapılandırması olarak iletilir. Varsayılan seçim `gpt-5.6-terra` ve orta çabadır; daha düşük kota tüketimi için `gpt-5.6-luna` veya düşük çaba, kapsamlı inceleme için `gpt-5.6-sol` ve yüksek çaba seçilebilir. `gpt-5.5`, `gpt-5.4` ve `gpt-5.4-mini` de kullanılabilir. Seçtiğiniz modelin hesabınızda erişilebilir olması gerekir.

Codex Desktop’ın varsayılan macOS yolu otomatik algılanır. Farklı bir Codex CLI kurulumu kullanıyorsanız başlatırken çalıştırılabilir yolunu belirtin: `CODEX_BIN=/tam/yol/codex npm run dev`.

## Repository seçimi

Review repository seçimi tamamen AI Review ekranından yapılır. Yol elle yazılabilir, kayıtlı proje kısayolu kullanılabilir veya macOS Finder üzerinden klasör seçilebilir. `commit` seçildiğinde commit alanı boş bırakılırsa `HEAD` kullanılır. `pr` seçildiğinde GitHub veya Azure DevOps pull request URL’sini ya da yalnızca PR numarasını girin. Workflow görevleri kendi proje seçimine ve Finder butonuna sahiptir; bu nedenle aynı panoda farklı repository'lere ait işler tutulabilir.

AI Review ve Workflow bağımsız modüllerdir. Review’de seçilen repository, sağlayıcı veya tamamlanan inceleme Workflow görevlerini oluşturmaz ya da değiştirmez. Her Workflow görevinin proje ve yerel LLM seçimi yalnızca görev oluşturulurken verilen değerden gelir.

Eski terminal akışı geriye dönük uyumluluk için `npm run review` komutuyla kullanılmaya devam edebilir, ancak normal kullanımda gerekli değildir.

### Kayıtlı projeler

Finder’dan seçilen Git repository'leri otomatik olarak kullanıcıya özel yerel proje listesine kaydedilir. Elle yazılmış bir yolu kaydetmek için ilgili formdaki `Mevcut yolu kaydet` düğmesini kullanın. Kayıtlı projeler Review ve Workflow görev formlarında tıklanabilir bir liste olarak gösterilir; Finder’da tekrar klasör aramak gerekmez.

Repository klasör adından kısa bir kısayol otomatik üretilir. Aynı adlı farklı repository'ler için `-2`, `-3` gibi güvenli ekler kullanılır. Terminalden ekleme ve silme yapmak isteyenler için `npm run projects` komutu kullanılmaya devam edebilir.

Kayıtlar ortak repository’ye eklenmez: varsayılan olarak kullanıcının `~/.config/ai-reviewer/projects.json` dosyasında tutulur. Başka bir konum kullanmak için `AI_REVIEWER_PROJECTS_FILE`, klasör seçmek için `AI_REVIEWER_CONFIG_DIR` ortam değişkenini tanımlayabilirsiniz. Böylece her kullanıcı kendi yollarını yönetir; paylaşılan kodda kişisel klasör yolları bulunmaz.

PR incelemesinde uygulama, `origin` uzak bağlantısından PR’ın merge ref’ini alır ve hedef dal ile kaynak dal arasındaki toplam diff’i inceler. Böylece PR içindeki tüm commit’ler tek inceleme kapsamına girer. GitHub için merge ref kullanılır. Azure DevOps URL’lerinde merge ref erişilebilir değilse uygulama Azure CLI ile PR’ın kaynak ve hedef dallarını alır; bunun için `az login` ve Azure DevOps eklentisi gerekir. Bulgular yalnızca diff’te eklenen satırlara bağlanabilir; değişmeyen dosya ve satırlara ilişkin yorumlar sonuçtan elenir. README ile `AGENTS.md` dosyaları yalnızca bu değişikliklerin etkisini değerlendirmek için bağlam sağlar.

Uygulama Git ile değişiklik bilgisini, diff’i, değişen dosyalara en yakın `README.md` belgelerini ve her değişen dosya için uygulanabilir `AGENTS.md` belgelerini otomatik yükler.

Hedef yol, Reviewer uygulamasının bulunduğu klasör değil, incelenecek projenin Git repository kökü (veya içindeki bir klasör) olmalıdır. Uygulama başlığında yüklü repository ve kısa değişiklik kimliği görünür.

## Güvenlik

Tarayıcı yerel araçların kimlik bilgilerini görmez. Sunucu yalnızca seçilen CLI sürecini çağırır ve mevcut yerel oturumu kullanır; kimlik bilgilerini uygulamaya kopyalamaz.
