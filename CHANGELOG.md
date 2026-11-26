# HANOUT EXPRESS v1.6.26

- Direct silent printing to the printer selected in application settings, without opening the Windows print dialog.
- Clear errors when the selected printer is unavailable or no default printer exists.
- PDF export measures the standalone receipt after fonts and images load, then uses the measured content height for thermal paper.
- Existing database, userData paths, and stored product/shop images remain unchanged.

## 1.6.20
- Added an in-app receipt preview before printing or exporting PDF.
- Reworked print/PDF actions to use the rendered receipt only, with clear preview, cancel, print, and PDF controls.
- Removed the fixed 300mm thermal page height; 58mm/80mm output now calculates a receipt-specific page height to reduce blank and extra pages.
- Applied the selected Windows printer and custom thermal page dimensions to print and PDF output.
- Preserved invoice data, database schema, printer settings, and existing sales workflows.

## 1.6.19
- Refined POS product cards with consistent image frames and non-distorting image fitting.
- Added a graceful placeholder for missing or unreadable product images.
- Added click-to-enlarge product image preview with bilingual accessible close controls.
- Improved product name, price, and stock readability in the sales grid.
- Preserved the existing image storage/read mechanism, product records, and database schema.

# Changelog

## 1.6.18
- Added instant barcode scanning at the POS: scan into the product search field and press Enter (standard scanner suffix) to add the exact matching product immediately.
- Re-scanning an item already in the cart increases its quantity, subject to available stock.
- Added compact plus/minus quantity controls in the invoice, with unit-aware increments and stock limits; direct quantity entry remains available.
- No database schema or stored data changes.


## 1.6.17
- Added Windows-installed printer discovery and printer selection in Settings.
- Saved printer preference and applied it to receipt printing.
- Added safe permanent deletion for non-administrator users while preserving audit history and journal entries.
- Kept the built-in administrator account protected.

## v1.6.15
- Fixed receipt printing layout so the application interface does not create extra printed pages.
- Set thermal receipt PDF page size to a single long receipt page (up to 300mm).
- Changed the POS confirm-sale button to green, including hover and disabled states.

## 1.6.14
- Refined the POS invoice panel with compact totals and clear payment buttons.
- Improved purchase payment summary contrast and layout.
- Restyled user permission controls for clearer selection.
- Preserved existing sale, purchase, permissions, and database workflows.

## v1.6.11 — إصلاح نهائي لمسار الاستعادة وتوحيد الإصدار
- جعل حذف النسخ المؤقتة القديمة بعد نجاح الاستعادة عملية تنظيف غير مؤثرة على نجاح الاستعادة، حتى لا يبدأ التراجع بعد حذف إحدى نسخ الرجوع.
- التحقق من أن مجلد الصور داخل النسخة الاحتياطية مجلد صالح قبل بدء الاستبدال.
- توحيد رقم الإصدار الظاهر في الواجهة مع رقم الحزمة.
- لا ميزات جديدة ولا تغيير في قاعدة البيانات أو مسار بيانات المستخدم.

## v1.6.9 — توحيد السنة الافتراضية للتقارير المحاسبية
- إصلاح اختيار بداية السنة الافتراضية في التقارير المحاسبية؛ أصبحت تُشتق من التاريخ المحلي للجهاز بدلاً من UTC.
- يمنع ذلك اختيار سنة سابقة عند فتح التقرير قرب منتصف الليل في بداية السنة، خصوصاً في المناطق ذات الإزاحة الزمنية الموجبة.
- لا تغيير في قاعدة البيانات أو البيانات أو آلية حساب التقارير.

## v1.6.8
- إصلاح حدود التاريخ في تقارير المبيعات: تحويل بداية ونهاية اليوم المحلي إلى UTC، واستخدام حد نهاية حصري لضمان إدراج جميع العمليات في اليوم المحدد.
- لا يتطلب هذا الإصلاح ترحيل قاعدة البيانات أو تعديل بيانات المستخدم.

## v1.6.8 — Correction du rapport commercial
- Correction du filtre des produits les plus vendus : qualification explicite de la quantité calculée après retours pour éviter l’erreur SQLite « ambiguous column name: quantity ».
- Aucun changement de structure SQLite, de calcul des ventes ou de chemin des données utilisateur.

# Changelog

## v1.6.6 — corrections et finition
- Ajout du journal des opérations au menu principal du compte administrateur. Le journal reste masqué pour les autres rôles.
- Correction de la génération des dates métier dans l’interface et dans Electron : utilisation de la date locale Windows au lieu de découper une date UTC.
- Correction de la déclaration des polices : IBM Plex Sans Arabic et Inter sont maintenant les familles préférées, avec des polices de repli.
- Mise à jour des numéros de version affichés dans l’application et la documentation.
- Aucun changement de schéma SQLite, d’appId ou d’emplacement des données utilisateur.

## v1.6.5 — Visual refresh
- Applied the approved HANOUT EXPRESS green identity and clean, data-focused interface.
- Refreshed navigation, dashboard cards, tables, forms, dialogs, POS product cards, and responsive layouts.
- Set IBM Plex Sans Arabic and Inter as the preferred interface fonts.
- Added automatic dark appearance based on the operating-system color preference.
- No database schema, business logic, or stored user-data paths changed.

- إزالة استدعاء غير ضروري لإعدادات السنة المالية من شاشة المشتريات، كان يسبب خطأً عند فتحها.
- إضافة تصدير تقرير الأداء التجاري والمنتجات الأكثر مبيعاً إلى CSV متوافق مع Excel بترميز UTF-8.
- منع طلب التقرير عند اختيار فترة تاريخ غير صحيحة.
- لا تغيير في قاعدة البيانات أو مسار حفظ البيانات.

## v1.6.3 — عرض صور المنتجات
- عرض صورة المنتج المحفوظة بجانب اسمه في قائمة المنتجات، مع أيقونة بديلة عند عدم وجود صورة.
- توحيد رقم الإصدار الظاهر في واجهة البرنامج مع رقم الحزمة.
- لا توجد تغييرات على قاعدة البيانات أو مسار حفظ البيانات.

## v1.6.2 — البحث وتصفية سجل المبيعات
- إضافة البحث في سجل المبيعات برقم الفاتورة أو اسم الزبون أو التاريخ.
- إضافة تصفية بسيطة حسب حالة الفاتورة: مكتملة، إرجاع جزئي، ملغاة، أو الكل.
- عرض آخر 100 فاتورة بدل 8 لتسهيل العثور على الفواتير الحديثة.
- تحديث رقم الإصدار الظاهر داخل البرنامج.
- لا تغيير في قاعدة البيانات أو البيانات السابقة.

## v1.6.1 — إلغاء الفاتورة بسهولة
- إضافة إجراء مباشر «إلغاء الفاتورة» بجانب كل فاتورة غير ملغاة في سجل المبيعات، دون الحاجة إلى فتح نافذة الإرجاع.
- تأكيد واضح قبل الإلغاء يشرح إعادة الكميات المتبقية إلى المخزون وتسجيل المبلغ المسترجع عند وجوده.
- استخدام آلية الإلغاء الحالية نفسها لتحديث المخزون والديون والصندوق والتقارير والقيود المرتبطة، مع الاحتفاظ بسجل الفاتورة والإرجاع.
- لا يسمح بإلغاء الفاتورة مرة ثانية بعد إلغائها.

## v1.6.0 — النسخة المبسطة للمحلات الصغيرة والمتوسطة
- إخفاء أقسام المحاسبة المتقدمة وسجل القيود من القائمة اليومية دون حذف الجداول أو البيانات التاريخية.
- الإبقاء على المبيعات والمخزون والمشتريات والزبائن والموردين والصندوق والمصاريف والتقارير والنسخ الاحتياطي.
- إضافة باركود مستطيل Code 39 لرقم الفاتورة على نسخة الطباعة.
- إضافة تصدير الفاتورة PDF مع اختيار مكان الحفظ من الحاسوب.
- الحفاظ على معرّف التطبيق وموقع قاعدة البيانات والصور دون تغيير.

## v1.5.0 — إدارة السنة المالية ومراجعة الإقفال
- إعداد وحفظ بداية ونهاية السنة المالية من خلال جدول الإعدادات الحالي دون إضافة جداول أو حذف بيانات.
- تقرير فحص الفترة: عدد القيود والأسطر ومجاميع المدين والدائن والقيود غير المتوازنة.
- عرض نتيجة الفترة والأرصدة المتراكمة قبل بدايتها لكل حساب عبر تقرير المراجعة.
- فحص توفر حساب حقوق الملكية 101 قبل متابعة إجراءات الإقفال.
- لا ينفذ هذا الإصدار إقفالاً نهائياً أو ينشئ قيود إقفال تلقائية؛ يظل الإقفال متوقفاً لحين المطابقة والمراجعة المحاسبية.

## v1.4.0 — Export des états comptables
- Export CSV UTF-8 du rapport financier regroupant la balance de vérification, le compte de résultat et le bilan.
- Export CSV du journal général selon la période sélectionnée.
- Conservation des exports existants du grand livre par compte.
- Les exports sont des rapports en lecture seule et ne modifient aucune donnée comptable.

## v1.3.0 — مطابقة حسابات الزبائن والموردين
- إضافة تقرير يقارن أرصدة فواتير الزبائن بالحساب العام 202.
- إضافة تقرير يقارن أرصدة فواتير الموردين بالحساب العام 201.
- عرض الرصيد المستحق لكل زبون ومورد داخل قسم المحاسبة.
- التقرير للقراءة فقط ولا يعدل المعاملات؛ وقد تظهر فروق بسبب العمليات القديمة أو الأرصدة الافتتاحية غير المسجلة.

# Changelog

## v1.1.0 — Automated accounting
- Automatic balanced journal entries for sales, purchases, sales returns, customer receipts, supplier payments, expenses and cash opening.
- Source-linked entries with duplicate protection.
- Expense deletion now creates a reversing journal entry to preserve accounting history.
- Added trial-balance, income-summary and balance-sheet checks.
- Additive migration for cost-of-goods-sold account 604.
- Historical transactions are not back-posted automatically.


## v1.0.0
- Added bilingual chart of accounts with seeded starter accounts and custom accounts.
- Added manual double-entry journal with server-side validation that debit equals credit.
- Added journal date filtering, entry details, account balances, and accounting permissions.
- Added additive SQLite migrations; existing business data is preserved.

## 0.9.0 — Retours et annulation des ventes

- Retours partiels ou complets des articles d’une facture.
- Annulation complète d’une facture via le retour de toutes les quantités restantes.
- Remise en stock automatique avec mouvement de stock dédié (hors services).
- Calcul du montant à rembourser selon le solde encore dû et les paiements déjà encaissés.
- Enregistrement du remboursement et prise en compte des sorties de caisse.
- Historique des retours conservé ; les factures ne sont pas supprimées.
- Mise à jour du relevé client et du solde dû.

# Changelog

## 0.8.0 — Journal des opérations
- Ajout d'un journal local des opérations avec date, heure, utilisateur, action et détails.
- Traçabilité des ventes, achats, modifications des données, paiements, caisse, dépenses, paramètres et gestion des utilisateurs.
- Enregistrement des connexions et déconnexions réussies.
- Exclusion explicite des mots de passe, empreintes et secrets des détails du journal.
- Écran de consultation réservé à l'administrateur, avec recherche et actualisation.
- Conservation des journaux existants et index SQLite ajouté sans supprimer les données.


## 0.6.0 — Fiabilité des rapports et des sauvegardes
- Correction des montants encaissés dans les rapports : les paiements sont désormais comptabilisés selon leur date réelle, y compris les règlements ultérieurs des clients.
- Même correction pour les règlements fournisseurs et les sorties liées aux achats.
- Calcul de la marge brute après répartition proportionnelle des remises de facture sur les lignes des ventes.
- Chiffre d'affaires des produits les plus vendus calculé après remise.
- Sauvegarde systématique du dossier images, même lorsqu'il est vide.
- Restauration exacte des images : les anciens fichiers non présents dans la sauvegarde ne restent plus sur l'appareil.
- Aucun changement de schéma SQLite et aucune suppression des données existantes.


## 0.4.1 — الصندوق والمصاريف والتقارير
- تفعيل إدارة المصاريف مع طرق الأداء.
- إضافة فتح وإغلاق جلسات الصندوق وحساب الرصيد النظري والفرق.
- إضافة سجل جلسات الصندوق.
- إضافة تقارير المبيعات والمشتريات والديون والمصاريف وهامش الربح والمنتجات الأكثر مبيعاً.
- إضافة ترحيل آمن لعمود طريقة أداء المصروف دون حذف البيانات السابقة.

## 0.4.0 — Gestion des clients et des crédits
- Ajout de la gestion des clients : création, modification, recherche et coordonnées.
- Ajout du compte client avec historique des ventes et paiements.
- Paiement partiel ou total à la caisse, avec affectation obligatoire à un client en cas de crédit.
- Encaissement des règlements clients, affectés aux factures impayées les plus anciennes.
- Conservation des ventes et paiements dans SQLite sans réinitialiser la base existante.

## 0.3.0 — Achats et fournisseurs
- Ajout de la gestion des fournisseurs (création, modification, liste et coordonnées).
- Ajout des factures d’achat multi-produits et des paiements partiels.
- Mise à jour transactionnelle du stock et de l’historique des mouvements.
- Calcul du coût d’achat moyen pondéré après chaque achat.
- Ajout des règlements fournisseurs et affectation aux factures impayées les plus anciennes.
- Ajout du relevé de compte fournisseur avec factures, paiements et solde restant.
- Réutilisation des tables SQLite existantes sans réinitialisation de la base.

## 0.2.3
- Attente du rendu de la facture et des images avant ouverture de la boîte d’impression.

## 0.2.2
- Déplacement du bouton des paramètres de facture vers l’en-tête de la page POS.


## 0.3.2 — Correction produits et images
- Bouton « Modifier le produit » rendu plus visible dans la liste des produits.
- Chargement des images POS tolérant les images manquantes ou illisibles.
- Repli visuel propre si une image produit ne peut pas être affichée.
- Vérification renforcée des chemins d’images locaux.

## 0.3.1
- Made the product edit action clearly visible in the products table.
- Added product image preview while adding/editing products.
- Loaded saved product images in POS product cards with a placeholder when no image exists.


## 0.5.0
- Added complete local backup containing the SQLite database and managed images/logo.
- Added backup integrity validation and safe restore flow with automatic application restart.
- Existing database location, appId and offline-first architecture remain unchanged.


## 0.7.0
- Added local login with scrypt password hashing.
- Added administrator, manager and cashier roles.
- Added module-level permissions, account activation/deactivation and password reset.
- Added user login audit entries and a one-time default administrator on empty databases.

## 0.7.0 — Comptes utilisateurs et autorisations
- Ajout d'un écran de connexion et de déconnexion.
- Création du compte administrateur initial uniquement si aucun compte n'existe.
- Ajout des rôles administrateur, gestionnaire et caissier.
- Gestion des autorisations par module et contrôle des appels IPC selon le compte connecté.
- Activation/désactivation des comptes et réinitialisation des mots de passe.
- Hachage des mots de passe avec scrypt et sel aléatoire.
- Migration SQLite additive pour conserver toutes les données existantes.


## 1.2.0 — Grand livre et relevé de compte
- Ajout du grand livre par compte avec solde d'ouverture, mouvements chronologiques, solde courant et solde de clôture.
- Filtrage du relevé par période et export CSV compatible avec Excel (encodage UTF-8).
- Contrôle des dates et du compte demandé côté processus principal.
- Consultation du grand livre sans création d'entrée dans le journal d'audit.
- Aucun changement de schéma SQLite : les données et l'emplacement de la base restent inchangés.

## v1.6.10 — حماية البيانات أثناء الاستعادة
- تحسين استعادة النسخة الاحتياطية: تجهيز قاعدة البيانات والصور والتحقق منها أولاً قبل استبدال البيانات الحالية.
- الاحتفاظ بنسخ رجوع مؤقتة لقاعدة البيانات والصور، ومحاولة إرجاع الحالة السابقة إذا فشلت إحدى خطوات الاستعادة.
- لا تغيير في بنية قاعدة البيانات أو مسارات بيانات المستخدم.


## v1.6.12 — تبسيط شاشة البيع وتحديث الهوية البصرية
- اختصار لوحة الفاتورة الحالية وتقليل ارتفاعها والمسافات داخلها.
- إضافة ثلاثة خيارات واضحة للدفع: نقداً / تسبيق / كريدي، وبالمقابل Espèces / Avance / Crédit بالفرنسية.
- في التسبيق يُدخل المستخدم المبلغ المدفوع، وفي الكريدي يُسجل المبلغ كاملاً كدين؛ ويتطلب الخياران اختيار زبون.
- اعتماد الأبيض كلون أساسي مع البرتقالي `#FF6500` والأزرق `#1E3E62` والكحلي `#0B192C` والأسود `#000000`.
- لا تغييرات على قاعدة البيانات أو مسارات بيانات المستخدم.

## v1.6.13 — الهوية البصرية Premium Retail
- تحديث الواجهة إلى الأبيض كأساس مع الكحلي والبرتقالي والأزرق والأسود.
- تحسين الشريط العلوي والقائمة الجانبية والبطاقات والجداول وشاشة البيع وأزرار الدفع الثلاثة.
- الحفاظ على اتجاه العربية RTL والفرنسية LTR دون تغيير وظائف البيع أو قاعدة البيانات.

## v1.6.16
- Reworked the operations journal to show localized action summaries instead of raw JSON in the table, with a readable detail view.
- Added quick customer creation directly from the POS customer selector for both advance and credit payments; the new customer is selected automatically.
- Preserved the existing customer and sales database APIs and data schema.


## v1.6.21
- إلغاء نافذة تكبير صور المنتجات في شاشة نقطة البيع.
- الضغط على أي مكان في بطاقة المنتج، بما في ذلك الصورة، يضيف المنتج مباشرة إلى الفاتورة.
- الإبقاء على الصور داخل البطاقات دون فتح معاينة أو تعطيل حدث إضافة المنتج.

## 1.6.22
- Corrected thermal/PDF page sizing to use the measured receipt height and removed the conflicting fixed 100mm page rule.
- A4 receipts use a standard A4 page without artificial minimum height.
- After a sale is saved, the receipt is displayed and the Windows print dialog opens automatically. Cancelling the print dialog does not cancel the saved sale.
- Made the Confirm Sale button explicitly green.


## v1.6.23
- إصلاح مسار الطباعة وPDF بإنشاء مستند فاتورة مستقل عن واجهة التطبيق.
- تمرير محتوى الفاتورة بتنسيقاته المحسوبة إلى نافذة طباعة مستقلة لتفادي صفحات PDF البيضاء ومشاكل معاينة Windows الناتجة عن CSS التطبيق.
- ضبط أحجام الورق الحراري وA4 والتحقق من أبعاد الصفحة.


## v1.6.25
- Fix Windows dialog printing by allowing the native dialog to choose the printer instead of forcing a saved device name.
- Improve print cancellation/failure feedback.
- Render PDF from a visible standalone receipt window and validate the generated PDF signature before saving.
