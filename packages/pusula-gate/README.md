<!-- Konum: packages/pusula-gate/README.md -->
# pusula-gate (v0.1 TASLAK)
toy-engine-lite karar kapısının PUSULA yorum-cevap akışına uyarlaması.

Hat: precheck (deterministik kriz/kategori/niyet) → Executor → doğrula → trustedIntent bağla → Policy Engine → Critic (farklı aile, yalnızca veto, 2 revizyon) → insan onayı (PUBLISH) → yeniden kontrol → etki → hash zincirli denetim.

- Kriz yorumunda model ÇAĞRILMAZ; Executor/Critic ham metni görmez (yalnızca enum/int olay).
- Hata, zaman aşımı, bozuk çıktı = ret. `process()` istisna fırlatmaz.
- Executor ve Critic aynı model ailesi olamaz (kurulumda hata).
- L2 otomatik yayın bu sürümde YOK; PUBLISH_REPLY her zaman insan onayı ister.
- Eşikler (hız sınırı, vaat listesi, KR/CAT) TASLAK, kalibrasyon bekliyor.
- Kural verisi: `node tools/extract-rules.mjs pusula_acilis_asistani.html`
- Test: `npm test` (24/24)

Enjekte edilecekler: `executor`, `critic` ({family, call}), `approver`, `effects` (DRAFT_REPLY, PUBLISH_REPLY, ESCALATE_TO_HUMAN, SET_PRIORITY), isteğe bağlı `getState` (safeMode).
