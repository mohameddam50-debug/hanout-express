# HANOUT EXPRESS v1.6.11

برنامج بيع ومخزون بسيط للمحلات الصغيرة والمتوسطة، يعمل دون إنترنت ويدعم العربية والفرنسية.

See `INSTALL-WINDOWS.txt` for Windows setup and testing instructions. Always back up the application data before upgrading.

# HANOUT EXPRESS — historique des fonctionnalités

Application Windows de gestion commerciale bilingue (arabe/français), hors ligne, basée sur Electron, React, Vite et SQLite.

## Installation (Windows PowerShell)

Ouvrez PowerShell dans le dossier `hanout-express`, puis exécutez :

```powershell
npm install
npx electron-rebuild -f -w better-sqlite3
npm run dev
```

Pour créer l’installateur Windows :

```powershell
npm run dist
```

## v1.6.6 — corrections et finition
- Ajout du raccourci vers le journal des opérations dans le menu administrateur.
- Correction des dates métier pour utiliser la date locale de Windows, sans décalage UTC.
- Mise à jour des polices préférées vers IBM Plex Sans Arabic et Inter.
- Conservation de la base SQLite, des images et du dossier userData existants.

## Fonctions disponibles
- Interface arabe/français avec RTL/LTR.
- Gestion des produits, catégories, prix, images et stock.
- Point de vente, panier, remises, factures et historique des ventes.
- طباعة الفواتير بمقاسات 58mm و80mm وA4 مع إعدادات المحل.
- باركود مستطيل Code 39 لرقم الفاتورة، وتصدير الفاتورة PDF مباشرة من سجل المبيعات.
- Gestion des clients : ajout, modification, recherche, coordonnées et historique.
- Vente نقداً أو بالدين مع تسجيل المبلغ المدفوع والمتبقي.
- تسديد ديون الزبائن كلياً أو جزئياً مع كشف الحساب.
- Gestion des fournisseurs : ajout, modification, coordonnées et solde dû.
- Factures d’achat multi-produits avec paiement total ou partiel.
- Mise à jour automatique du stock et de l’historique des mouvements à la validation d’un achat.
- Mise à jour du coût d’achat moyen pondéré des produits.
- Paiements aux fournisseurs, affectés aux factures impayées les plus anciennes.
- Relevé de compte fournisseur (factures, paiements et solde restant).
- Gestion des clients, soldes débiteurs et règlements partiels.
- Vente comptant ou à crédit avec affectation des règlements aux factures les plus anciennes.
- Gestion des dépenses avec mode de paiement.
- Ouverture et clôture de caisse avec calcul du solde théorique et de l'écart de caisse.
- Rapports par période : ventes, encaissements réels selon la date du paiement, dettes des factures de la période, achats, dépenses, marge brute après remise et produits les plus vendus après remise.

## Important : données existantes
La base SQLite reste dans le dossier `userData` d’Electron (`data/hanout-express.sqlite`). Cette version réutilise les tables existantes `suppliers`, `purchases`, `purchase_items` et `payments` ; elle ne supprime ni ne réinitialise la base de données.

Avant la première utilisation, gardez une copie de sauvegarde du dossier de données. Nنسخ مجلد بيانات التطبيق قبل التحديث كإجراء احتياطي.

## سجل المبيعات في v1.6.2
يمكن البحث عن الفواتير برقمها أو باسم الزبون أو بتاريخها، وتصفية السجل حسب حالة الفاتورة. يعرض السجل آخر 100 فاتورة.

## تبسيط الواجهة في v1.6.1
تم إخفاء المحاسبة المتقدمة من القائمة الرئيسية لتبقى الواجهة موجهة للبيع اليومي وإدارة المحل. لم تُحذف بيانات أو جداول المحاسبة القديمة.

## Limites connues
- إدارة المستخدمين وتسجيل الدخول والصلاحيات مفعّلة، كما يتوفر سجل العمليات لمدير النظام.
- صافي الربح المعروض يطرح المصاريف المسجلة فقط؛ ولا يشمل الضرائب أو التكاليف غير المسجلة.
- لم يتم اختبار هذا الإصدار على جهاز Windows فعلي ضمن عملية إعداد الحزمة؛ يجب إجراء الاختبارات الموضحة في ملف INSTALL-WINDOWS.txt قبل استخدامه على بيانات العمل الحقيقية.


## النسخ الاحتياطي والاسترجاع (0.6.0)
من قسم **الإعدادات** يمكنك إنشاء نسخة احتياطية كاملة. اختر مجلداً لحفظ النسخة؛ سيُنشأ داخله مجلد بتاريخ العملية يحتوي على `database.sqlite` ومجلد `images` حتى عندما لا توجد صور. للاسترجاع اختر مجلد النسخة نفسه، وسيتم فحص قاعدة البيانات قبل استبدال البيانات الحالية وإعادة تشغيل التطبيق. لا تحذف مجلد النسخة بعد إنشائه.


## v0.9.0 — إرجاع المبيعات وإلغاء الفواتير
- إرجاع جزئي أو كامل للمنتجات من سجل المبيعات.
- إرجاع الكميات إلى المخزون تلقائياً مع تسجيل حركة مخزون مستقلة.
- حساب قيمة الإرجاع بعد توزيع التخفيض على المنتجات، ومراعاة الدين والمدفوعات السابقة لتحديد المبلغ الذي يجب رده فعلياً.
- تسجيل المبالغ المسترجعة كمصاريف نقدية عند اختيار الأداء نقداً، مع تحديث كشف حساب الزبون والصندوق والتقارير.
- إلغاء الفاتورة بالكامل بإرجاع كل الكميات المتبقية، مع الاحتفاظ بالفاتورة وسجل الإرجاع دون حذف.

## v0.8.0 — سجل العمليات
- تسجيل عمليات البيع والشراء وتعديلات المنتجات والزبائن والموردين والمخزون والمصاريف والصندوق والإعدادات وإدارة المستخدمين.
- تسجيل الدخول والخروج الناجحين مع اسم المستخدم والتاريخ والوقت.
- استبعاد كلمات المرور والأسرار من تفاصيل السجل.
- شاشة سجل العمليات مع البحث، مخصصة لمدير النظام.
- الاحتفاظ بالسجلات السابقة وإضافة فهرس SQLite دون حذف البيانات.

## v0.7.0 — المستخدمون وتسجيل الدخول
- شاشة تسجيل دخول محلية بحسابات مستخدمين منفصلة.
- إنشاء حسابات موظفين بأدوار مسير أو موظف صندوق.
- تخصيص صلاحيات الوصول إلى أقسام البرنامج.
- تفعيل وتعطيل الحسابات وتغيير كلمات المرور.
- تخزين كلمات المرور باستخدام scrypt مع salt عشوائي.

**بيانات الدخول لأول تشغيل فقط:** `admin` / `admin12345`. غيّر كلمة المرور فوراً من قسم المستخدمين.

## v0.7.0 — المستخدمون والصلاحيات
- تسجيل دخول قبل فتح البرنامج، مع تسجيل خروج.
- حساب مدير النظام وحسابات مستقلة للموظفين.
- أدوار: مدير النظام، المسير، وموظف الصندوق.
- صلاحيات منفصلة للأقسام، مع تطبيق التحقق في واجهة البرنامج وعمليات IPC.
- تفعيل وتعطيل حساب الموظف وإعادة تعيين كلمة مروره.
- كلمات المرور لا تُحفظ كنص واضح؛ تستخدم scrypt مع salt عشوائي.
- ترحيل قاعدة البيانات بإضافة عمود الصلاحيات فقط، دون حذف الجداول أو البيانات الحالية.

### بيانات الدخول الأولى
في قاعدة بيانات لا تحتوي على أي مستخدمين، ينشئ البرنامج حساب المدير التالي تلقائياً:
- المستخدم: `admin`
- كلمة المرور: `admin12345`

غيّر كلمة المرور فور تسجيل الدخول، ثم أنشئ حساباً منفصلاً لكل موظف. إذا كانت قاعدة البيانات تحتوي مسبقاً على مستخدمين، فلن ينشئ البرنامج حساباً افتراضياً جديداً.


في الإصدار 0.9.0: يمكن إرجاع بعض المنتجات أو إلغاء الفاتورة بالكامل من سجل المبيعات. تُعاد الكميات إلى المخزون تلقائياً، ويُحسب المبلغ المسترجع بعد مراعاة الدين المتبقي والمدفوعات السابقة. تحفظ الفواتير وحركات الإرجاع في قاعدة البيانات ولا تُحذف.


## v1.0.0 — Accounting foundation
The accounting module provides a starter chart of accounts, custom account creation, balanced manual journal entries, journal history with date filters, and account balances. It is an accounting foundation, not yet a complete automated statutory accounting/tax system.


## v1.2.0 — Comptabilisation automatique et états financiers
- Comptabilisation automatique des ventes, achats, retours, règlements clients/fournisseurs, dépenses et ouverture de caisse.
- Chaque écriture automatique est équilibrée et liée à son opération source pour éviter les doublons.
- Les suppressions de dépenses génèrent une écriture d’extourne au lieu d’effacer l’historique comptable.
- Ajout du compte 604 « Coût des marchandises vendues » par migration additive.
- Ajout de la synthèse financière : balance de vérification, produits/charges, résultat net et équilibre du bilan.
- Les opérations antérieures à cette version ne sont pas comptabilisées rétroactivement.

**Attention :** les états financiers ne remplacent pas encore une clôture comptable ou une déclaration fiscale. Les soldes d’ouverture et les opérations antérieures doivent être saisis/repris dans le journal avant d’utiliser ces états comme comptes définitifs.


## v1.2.0 — دفتر الأستاذ العام
- كشف حركة مستقل لكل حساب مع الرصيد الافتتاحي والحركات والرصيد الجاري والختامي.
- تحديد الفترة الزمنية وتصدير الكشف بصيغة CSV المتوافقة مع Excel.
- لا تتطلب هذه الإضافة أي تعديل على قاعدة البيانات.


## v1.3.0 — Rapprochement auxiliaire
- Added customer and supplier subledger totals compared with general-ledger control accounts 202 and 201.
- Added party-by-party outstanding balance lists in the accounting module.
- Reconciliation is read-only and highlights differences without modifying transactions.
- Differences may remain for historical transactions not posted automatically or missing opening balances.


## v1.5.0 — Gestion de l’exercice
- Paramétrage des dates de l’exercice comptable sans modifier les données historiques.
- Contrôle des journaux : nombre d’écritures, lignes, totaux débit/crédit et écritures déséquilibrées.
- Synthèse du résultat de la période et des soldes antérieurs par compte.
- Vérification de la présence du compte de capitaux propres 101.
- Aucune clôture définitive ni écriture de clôture automatique n’est générée : la clôture reste soumise aux rapprochements et à la validation comptable.
