[**日本語**](./README.md) ・ [English](./README.en.md)

# WebGPU N体重力サンドボックス(starforge-webgpu)

<!-- tech-stack:start (auto-generated) -->
<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-005A9C?style=for-the-badge&logo=webgpu&logoColor=white" alt="WebGPU">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5">
</p>
<!-- tech-stack:end -->

数千体の **N 体重力シミュ**をコンピュートシェーダで GPU 上に走らせる、シネマティックな物理サンドボックス作品集。
入口の**展示室**に並ぶ厳選シーンをクリックすると**全画面没入**で立ち上がり、星をつかんで投げたり、重い天体を置いたり、群れをぶつけたり、時間を一気に早送り（ハイパーラプス）しながら宇宙の挙動を観察できる。
CSS アニメ研究の「本物の演算」版。バックエンドなし・ネットワークなし、素の ES モジュールで動く。

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
画面下のツールバー、または数字キー `1`–`4` で切り替え。各道具の説明は折りたためる**ガイド**に表示。

| 道具 | 操作 | 効果 |
|---|---|---|
| つかむ・投げる | ドラッグで引き寄せ → 離すと投げる | カーソル近傍に引力。離した瞬間にカーソルの勢いをインパルスとして与える |
| 重い星を置く | ドラッグ（向き＝初速） | 大質量の天体を設置。周囲を巻き込み、中心づくり・降着のきっかけに |
| ぶつける | ドラッグした方向へ発射 | 小さな星の群れを撃ち込み、既存の集団と衝突軸を作る |
| 爆発させる | クリック | その地点から外向きの衝撃波。固まった構造を吹き飛ばす |

視点: ホイールでズーム／右・Shift ドラッグでパン／`R` リセット／`Esc` 展示室。
> 介入はすべて GPU の compute パス（`interact.wgsl`）で全体に作用。CPU への読み戻し・ピッキングなし。

## 時間操作（前進が主役）
速度の正体は **1 フレームあたりの物理サブステップ数**（`dt` は固定なので積分が破綻しない）。

- `Space` 停止／再開・`,` `.` で遅く／速く（0.25x〜64x）・`h` で **ハイパーラプス**（数億年を数秒に圧縮）・`n` でコマ送り。
- 体数に応じた**負荷ガード**で実効サブステップを自動調整し、HUD に実効レート（例 `64x (~8x)`）を表示。
- **エポック時計**（`T+ Myr/Gyr`）で経過時間を可視化。
- `z` で**少し前に巻き戻し**（数秒ごとと操作の直前に状態を自動スナップショット。GPU バッファコピーの軽量チェックポイント）。

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
node test/bindings.test.mjs                          # バインディング整合（31 件）
```
> 実際の描画（軌道・bloom・トレイル）は WebGPU ブラウザでの目視確認が前提。
