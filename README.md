# Reviewer AI

Commit veya pull request incelemesi yapan küçük bir web uygulaması. Yerelde oturum açmış Codex CLI’ı kullanır; API anahtarı veya API kredisi gerektirmez. Diff, değişiklik metadatası, ilgili README ve isteğe bağlı inceleme notu Codex’e iletilir; sonuç yalnızca önceden tanımlı JSON şemasında kabul edilir.

## Çalıştırma

Node.js 18 veya üstü, macOS ve Codex CLI gerekir. Codex’e ChatGPT hesabınızla giriş yapmış olmalısınız.

```bash
npm run codex:status
# Oturum yoksa: codex login
npm run review
```

Ardından `http://localhost:3000` adresini açın.

İncelemeler Codex hesabınızdaki kullanım kotasından harcanır. Uygulama API anahtarınızı veya ChatGPT oturum belirtecini okumaz; yalnızca kurulu Codex CLI komutunu çağırır. Her çalıştırma `read-only` sandbox ve `--ephemeral` modunda yürütülür. Reviewer projesi kendi başına Git repository’si olmak zorunda olmadığından CLI, yalnızca bu aracı başlatan süreçte `--skip-git-repo-check` ile çalışır; incelenecek Git bağlamı formdan sağlanır.

Arayüzdeki model seçici Codex CLI’a `--model`, çaba seçici ise `model_reasoning_effort` yapılandırması olarak iletilir. Varsayılan seçim `gpt-5.6-terra` ve orta çabadır; daha düşük kota tüketimi için `gpt-5.6-luna` veya düşük çaba, kapsamlı inceleme için `gpt-5.6-sol` ve yüksek çaba seçilebilir. `gpt-5.5`, `gpt-5.4` ve `gpt-5.4-mini` de kullanılabilir. Seçtiğiniz modelin hesabınızda erişilebilir olması gerekir.

Codex Desktop’ın varsayılan macOS yolu otomatik algılanır. Farklı bir Codex CLI kurulumu kullanıyorsanız başlatırken çalıştırılabilir yolunu belirtin: `CODEX_BIN=/tam/yol/codex npm run dev`.

## Repository seçimi

`npm run review` sırasıyla repository yolunu, inceleme türünü ve hedefi sorar. `commit` seçildiğinde commit kimliği boş bırakılırsa `HEAD` kullanılır. `pr` seçildiğinde GitHub veya Azure DevOps pull request URL’sini ya da yalnızca PR numarasını girin.

PR incelemesinde uygulama, `origin` uzak bağlantısından PR’ın merge ref’ini alır ve hedef dal ile kaynak dal arasındaki toplam diff’i inceler. Böylece PR içindeki tüm commit’ler tek inceleme kapsamına girer. Uzak repository’ye erişiminiz ve PR merge ref’inin erişilebilir olması gerekir.

Uygulama Git ile değişiklik bilgisini, diff’i, değişen dosyalara en yakın `README.md` belgelerini ve her değişen dosya için uygulanabilir `AGENTS.md` belgelerini otomatik yükler.

```bash
npm run review
```

Hedef yol, Reviewer uygulamasının bulunduğu klasör değil, incelenecek projenin Git repository kökü (veya içindeki bir klasör) olmalıdır. Uygulama başlığında yüklü repository ve kısa değişiklik kimliği görünür.

## Güvenlik

Tarayıcı Codex kimlik bilgilerini görmez. Yerel sunucu, `/api/review` isteğini ayrı bir salt-okunur Codex CLI sürecine iletir.
