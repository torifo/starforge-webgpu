[**日本語**](./README.md) ・ [English](./README.en.md)

# WebGPU N体重力サンドボックス(starforge-webgpu)

<!-- tech-stack:start (auto-generated) -->
<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-005A9C?style=for-the-badge&logo=webgpu&logoColor=white" alt="WebGPU">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
</p>
<!-- tech-stack:end -->

数千体の **N 体重力シミュレーション**をコンピュートシェーダで GPU 上に走らせる、シネマティックな物理サンドボックス作品集。
入口の**展示室**から厳選シーンを選ぶと**全画面**で立ち上がる。星をつかんで投げる、重い天体を置く、群れをぶつける、時間を一気に早送りする（ハイパーラプス）——そうやって宇宙のふるまいを自分の手で動かせる。
CSS アニメ研究の「本物の演算」版。バックエンドもネットワークもなく、素の ES モジュールだけで動く。

## スクリーンショット

![展示室（6 シーン）](docs/screenshots/gallery.jpg)

| 銀河衝突（時間操作・操作ツール・ガイドを表示中） | 降着円盤 |
|---|---|
| ![銀河衝突](docs/screenshots/galaxy-collision.jpg) | ![降着円盤](docs/screenshots/accretion-disk.jpg) |

## 体験フロー
**展示室（6 シーン）→ クリックで全画面没入 → Esc で戻る**。シーンは URL ハッシュ（`#scene=galaxy`）で保持。

| シーン | 見どころ |
|---|---|
| 実太陽系 | 安定軌道・Kepler のリズム |
| 銀河衝突 | 潮汐の尾・最大のスペクタクル |
| 降着円盤 | 中心へ螺旋・輝くリング |
| 誕生（重力崩壊） | 拡散ガス → 構造形成 |
| 重力スリングショット | 侵入天体の加速・散乱 |
| 球状星団 | 多体凝集・GPU の本領 |

## 画作り（シネマティック演出）
- **Bloom**: 明るい核が光をにじませる。
- **軌道トレイル**: 履歴バッファの減衰合成で、天体が消えゆく光の尾を引く。
- **星雲バックドロップ**: 淡い色ガスで奥行きと余韻。
- HDR オフスクリーン（rgba16float）→ ACES トーンマップで合成。

## 操作（4 つの道具）
画面下のツールバーか、数字キー `1`–`4` で道具を持ち替える。それぞれの説明は、折りたためる**ガイド**に表示される。

| 道具 | 使い方 | 起きること |
|---|---|---|
| つかむ・投げる | ドラッグで引き寄せ、離すと放り投げる | カーソルの周りに引力が働き、手を離した瞬間にその勢いがそのまま速度になる |
| 重い星を置く | ドラッグした向きと長さが初速になる | 大きな質量の天体が生まれ、周りの星を巻き込む。中心をつくったり、降着を始めるきっかけに |
| ぶつける | ドラッグした方向へ撃ち出す | 小さな星の群れが飛んでいき、今ある集団とぶつかって衝突や潮汐の尾をつくる |
| 爆発させる | クリックした場所が中心になる | そこから外向きの衝撃波が広がり、固まった構造を一気に吹き飛ばす |

視点：ホイールでズーム、右ドラッグ（または Shift ＋ドラッグ）でパン、`R` でリセット、`Esc` で展示室へ。
> これらの操作はすべて GPU の compute パス（`interact.wgsl`）で全体にかかる。CPU 側へ読み戻したり、当たり判定を取得したりはしていない。

## 時間操作（前に進めるのが主役）
ここでの「速さ」は、**1 フレームで物理を何回進めるか（サブステップ数）**で決まる。刻み幅 `dt` は一定のままなので、いくら速くしても計算が破綻しない。

- `Space` で停止／再開、`,` `.` で遅く／速く（0.25〜64 倍）、`h` で**ハイパーラプス**（数億年を数秒に圧縮）、`n` で 1 コマずつ進める。
- 星の数が多いときは**自動で負荷を抑え**、HUD に実際の倍率（例：`64x (~8x)`）を表示する。
- **経過時間の時計**（`T+ Myr/Gyr`）で、どれだけ時が進んだかがわかる。
- `z` で**少し前に巻き戻せる**。状態は数秒ごとと、操作する直前に自動で記録している（GPU バッファをコピーするだけの軽いチェックポイント）。

## スタック
- **描画**: WebGPU（compute パイプラインで力積分、render パイプラインで点群）＋ WGSL
- **構成**: 素の ES モジュール（ビルド不要）・依存ゼロ・CDN なし
- **フォールバック**: WebGPU 非対応時は明示メッセージ（白画面にしない）

## 動かし方・検証
WebGPU 対応ブラウザ（最近の Chrome / Edge 等）で:
```sh
python3 -m http.server 8095   # → http://localhost:8095/
```

```sh
for f in src/shaders/*.wgsl; do naga "$f"; done   # WGSL 検証
for f in src/*.js; do node --check "$f"; done       # JS 構文
node test/scenes.test.mjs                            # シーン初期条件（78 件）
node test/bindings.test.mjs                          # バインディング整合（46 件）
```
> 実際の描画（軌道・bloom・トレイル）は WebGPU ブラウザでの目視確認が前提。
