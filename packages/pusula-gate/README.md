
<!-- Konum: packages/pusula-gate/README.md -->
# pusula-gate (v0.1 TASLAK)
toy-engine-lite karar kapısının PUSULA yorum-cevap akışına uyarlaması.

Hat: precheck (deterministik kriz/kategori/niyet) → Executor → doğrula → trustedIntent bağla → Policy Engine → Critic (farklı aile, yalnızca veto, 2 revizyon) → insan onayı (PUBLISH) → yeniden kontrol → etki → hash zincirli denetim.

- Kriz yorumunda model ÇAĞRILMAZ; Executor/Critic ham metni görmez (yalnızca enum/int olay).
- Hata, zaman aşımı, bozuk çıktı = ret. `process()` istisna fırlatmaz.
- Executor ve Critic aynı model ailesi olamaz (kurulumda hata).
- L2 otomatik yayın bu sürümde YOK; PUBLISH_REPLY her zaman insan onayı ister.
- Sayısal ayarlar (maxRevisions, hız sınırları, zaman aşımları) kodda DEĞİL, `config` ile dışarıdan verilir; varsayılan yok, eksik/geçersiz = `CONFIG_INVALID` (AMC-9). Değerler TASLAK; vaat listesi ve KR/CAT de kalibrasyon bekliyor.
- Kural verisi: `node tools/extract-rules.mjs pusula_acilis_asistani.html`
- Test: `npm test`

Enjekte edilecekler: `config` ({maxRevisions, rate:{windowMs,defaultLimit,perAction}, timeoutsMs:{model,critic,effect}}), `executor`, `critic` ({family, call}), `approver`, `effects` (DRAFT_REPLY, PUBLISH_REPLY, ESCALATE_TO_HUMAN, SET_PRIORITY), isteğe bağlı `getState` (safeMode).
