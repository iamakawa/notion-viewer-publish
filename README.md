# Notion Viewer (Netlify Edition)

軽量なNotionデータベースカードビューア。Notion のプロパティ名を自由に変更して、自分専用のビューアを作成できます。

## デモ
実際に動作を確認できるデモサイトを用意しています。

- **デモサイト**: [https://timely-biscotti-d12750.netlify.app/](https://timely-biscotti-d12750.netlify.app/)
  - ユーザー名: `demouser`
  - パスワード: `demopass`
- **デモ用 Notion ページ**: [こちら](https://iamakawa.notion.site/33d556c46e3f80e89995c4a2a67a7f22?v=33d556c46e3f801b93d8000c754fd6c6)

## 特徴
- **プロパティ・マッピング**: 環境変数を設定するだけで、Notion の任意のプロパティを表示できます。
- **Netlify Functions 対応**: サーバーレスで動作するため、維持費がかかりません。
- **プライベート認証**: ユーザー名とパスワードによる認証画面を搭載。

## セットアップ

### 1. Notion の準備
- 表示したい Notion データベースの ID を取得します。
- Notion インテグレーションを作成し、API キーを取得してデータベースに権限を与えてください。

### 2. デプロイと設定

#### A. Netlify でホスティングする場合（推奨）
1. このリポジトリを GitHub にプッシュします。
2. Netlify で `Import an existing project` からリポジトリを選択します。
3. `Site configuration > Environment variables` で以下の環境変数を設定します：

| 環境変数名 | 説明 | デフォルト値 |
| :--- | :--- | :--- |
| `NOTION_API_KEY` | Notion API キー | (必須) |
| `NOTION_DATABASE_ID` | Notion データベース ID | (必須) |
| `BASIC_USER` | ログインユーザー名 | (なし = 認証なし) |
| `BASIC_PASS` | ログインパスワード | (なし = 認証なし) |
| `NOTION_PROP_TITLE` | タイトルとして表示するプロパティ名 | `Title` |
| `NOTION_PROP_DETAIL` | 本文として表示するプロパティ名 | `Detail` |
| `NOTION_PROP_COMMENT` | コメント書き込み先のプロパティ名 | `MetaNote` |
| `NOTION_PROP_LIKE` | いいね（数値）のプロパティ名 | `fav` |
| `NOTION_PROP_EXTRAS` | その他表示したいプロパティ名（カンマ区切り） | (なし) |
| `NOTION_SORT_PROP` | ソートに使用するプロパティ名 | `changedDay` |
| `NOTION_SORT_DIR` | ソート順 (`ascending` または `descending`) | `descending` |

※ `NOTION_PROP_EXTRAS` に指定したプロパティは、リレーション、マルチセレクト、日付、チェックボックス等を自動判別して表示します。

#### B. ローカル環境で実行する場合
1. 依存関係をインストールします： `npm install`
2. プロジェクトのルートに `.env` ファイルを作成し、上記表の変数を記述します。
   ```env
   NOTION_API_KEY=secret_xxx
   NOTION_DATABASE_ID=xxx
   BASIC_USER=admin
   BASIC_PASS=password123
   NOTION_PROP_EXTRAS=Tags,Team_List,DueDate
   ```
3. Netlify CLI を使用して起動します： `npm install -g netlify-cli` ➡ `netlify dev`

## プロジェクト構成
- `public/`: フロントエンド資産（HTML, CSS, JS）
- `netlify/functions/api.js`: 動的プロパティ解決ロジックを含むサーバーレス関数
- `netlify.toml`: ビルド・リダイレクト設定
