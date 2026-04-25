📄 README.md pour ProGestion
markdown
# 🧾 ProGestion - Gestion de Devis & Factures

**ProGestion** est une application web complète pour créer, gérer et exporter des devis, factures et proformas. Elle permet une synchronisation cloud multi-appareils et offre une interface moderne responsive.

🔗 **Demo en ligne** : [progestion.app](https://emeride7.github.io/facture_devis/)

---

## ✨ Fonctionnalités

### 📝 Gestion des documents
- ✅ Création de **Devis**, **Factures** et **Pro Forma**
- ✅ Numérotation automatique (ex: D26-0001, F26-0001)
- ✅ Date de validité pour devis et proformas
- ✅ Logo de l'entreprise (upload image)
- ✅ Signature numérique (upload image)
- ✅ Support multi-devises (CFA, EUR, USD, GBP, XOF, MAD)
- ✅ TVA et Remise configurables

### 👥 Gestion clients
- ✅ Carnet clients avec historique
- ✅ Auto-complétion des clients
- ✅ CA total par client
- ✅ Sauvegarde automatique des coordonnées

### 📊 Tableau de bord (Dashboard)
- ✅ Chiffre d'affaires total
- ✅ Nombre de documents par type
- ✅ Taux de conversion (devis acceptés/envoyés)
- ✅ Devis expirant dans 7 jours
- ✅ Top 5 clients (par CA)
- ✅ Répartition des statuts
- ✅ Derniers documents

### 📤 Export
- ✅ **PDF** : Document professionnel avec logo et signature
- ✅ **Excel** : Tableau des prestations
- ✅ **WhatsApp** : Partage instantané avec message personnalisé

### ☁️ Synchronisation
- ✅ Authentification via **Supabase**
- ✅ Sauvegarde cloud multi-appareils
- ✅ Stockage local hors ligne
- ✅ Fusion intelligente des données

### 🔄 Productivité
- ✅ Auto-save (700ms)
- ✅ Undo/Redo (Ctrl+Z / Ctrl+Y)
- ✅ Templates pré-définis (8 modèles)
- ✅ Raccourcis clavier
- ✅ Mode responsive (mobile/desktop)

---

## 🛠️ Technologies utilisées

| Technologie | Utilisation |
|-------------|-------------|
| HTML5 / CSS3 | Structure et styles |
| JavaScript (Vanilla) | Logique métier |
| Supabase | Authentification + Base de données |
| jsPDF | Génération PDF |
| SheetJS (XLSX) | Export Excel |
| Font Awesome | Icônes |

---

## 🚀 Installation

### Prérequis
- Un compte [Supabase](https://supabase.com) (gratuit)
- Un hébergeur web (Netlify, Vercel, GitHub Pages, etc.)

### Étapes

1. **Cloner le dépôt**
```bash
git clone https://github.com/votre-username/progestion.git
cd progestion
Configurer Supabase

Créer un projet sur Supabase

Exécuter les scripts SQL suivants :

sql
-- Table des documents
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  doc_number TEXT NOT NULL,
  doc_date TEXT,
  doc_status TEXT DEFAULT 'draft',
  client_name TEXT,
  total_ttc NUMERIC,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Table des profils utilisateurs
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Activer RLS (Row Level Security)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Politiques de sécurité
CREATE POLICY "Users can view own documents" ON documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own documents" ON documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own documents" ON documents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own documents" ON documents FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON user_profiles FOR UPDATE USING (auth.uid() = user_id);
Configurer les identifiants

Ouvrir script.js

Remplacer les valeurs SUPABASE_URL et SUPABASE_ANON

Déployer

Uploader les fichiers sur votre hébergeur

Ou utiliser Netlify/Vercel (drag & drop)

⌨️ Raccourcis clavier
Raccourci	Action
Ctrl+S	Sauvegarder le document
Ctrl+Z	Annuler
Ctrl+Y	Rétablir
Ctrl+N	Nouveau document
Ctrl+H	Ouvrir l'historique
Ctrl+P	Exporter PDF
Échap	Fermer les panneaux
📱 Compatibilité
Appareil	Statut
Desktop (Windows/Mac/Linux)	✅ Parfait
Tablette (iPad/Android)	✅ Adapté
Mobile (iPhone/Android)	✅ Responsive
Impression	✅ Optimisé
🧪 Tests
bash
# Aucun build nécessaire - ouvrir directement index.html
# Un serveur local recommande pour les tests Supabase
npx serve .
📁 Structure du projet
text
progestion/
├── index.html          # Structure principale
├── style.css           # Styles (responsive inclus)
├── script.js           # Logique complète
└── README.md           # Documentation
🤝 Contribution
Les contributions sont les bienvenues !

Forker le projet

Créer une branche (git checkout -b feature/amazing-feature)

Commiter (git commit -m 'Add amazing feature')

Pusher (git push origin feature/amazing-feature)

Ouvrir une Pull Request



👤 Auteur
DJIVOESSOUN EMERIDE @Emeride7

🙏 Remerciements
Supabase pour l'authentification et la BDD

jsPDF pour les exports PDF

SheetJS pour les exports Excel

Font Awesome pour les icônes

📧 Contact
Pour toute question ou suggestion : votre@email.com

⭐ Support
Si ce projet vous est utile, n'hésitez pas à :

Laisser une ⭐ sur GitHub

Partager autour de vous

Signaler les bugs dans les issues

🗺️ Roadmap
Mode sombre

Envoi par email

Signature électronique (canvas)


Version anglaise

Export CSV des statistiques

Relances automatiques

Tags / Catégories

Accès client avec lien sécurisé

Fait avec ❤️ pour les entrepreneurs africains


---

## 📝 Version courte (si vous préférez)

```markdown
# 🧾 ProGestion

Application web de gestion de devis, factures et proformas.

## Fonctionnalités
- ✅ Création Devis / Facture / Pro Forma
- ✅ Numérotation automatique
- ✅ Carnet clients
- ✅ Dashboard statistiques
- ✅ Export PDF / Excel / WhatsApp
- ✅ Synchronisation cloud (Supabase)
- ✅ Auto-save, Undo/Redo
- ✅ Templates pré-définis
- ✅ Responsive mobile/desktop

## Technologies
- HTML5, CSS3, JavaScript Vanilla
- Supabase (Auth + Database)
- jsPDF, SheetJS

## Installation
1. Cloner le dépôt
2. Configurer Supabase (SQL fourni)
3. Remplacer les clés API dans script.js
4. Déployer (Netlify/Vercel/GitHub Pages)


MIT
