#!/usr/bin/env python3
"""나래 짝꿍 카드 — 고품질 음성 파일 만들기

data/game-data.js 의 모든 문장(안내 문장 + 물건 가격 문장)을 AI 음성으로 녹음해
assets/audio/ 에 저장하고 assets/audio/manifest.js 를 갱신합니다.
manifest 에 파일이 등록되면 게임은 브라우저 음성 대신 이 녹음 파일을 재생합니다.

사용법 (프로젝트 폴더에서):
    # Microsoft Edge 자연 음성 (API 키 필요 없음, 기본값) — pip install edge-tts
    python tools/generate_audio.py                      # SunHi(여성) 음성
    python tools/generate_audio.py --voice ko-KR-InJoonNeural   # 남성 음성

    # ElevenLabs (한국어가 가장 자연스러움, MP3)
    set ELEVENLABS_API_KEY=...        (PowerShell: $env:ELEVENLABS_API_KEY="...")
    python tools/generate_audio.py --provider elevenlabs

    # Gemini (WAV)
    set GEMINI_API_KEY=...
    python tools/generate_audio.py --provider gemini --voice Kore

    # 녹음 파일을 지우고 브라우저 음성으로 되돌리기
    python tools/generate_audio.py --reset

외부 라이브러리 없이 파이썬 표준 라이브러리만 사용합니다.
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "data" / "game-data.js"
AUDIO_DIR = ROOT / "assets" / "audio"
MANIFEST = AUDIO_DIR / "manifest.js"

ELEVEN_VOICES = {  # 한국어 프리셋
    "Yuna": "xi3rF0t7dg7uN2M0WUhr",
}


def load_lines():
    text = DATA_JS.read_text(encoding="utf-8")
    m = re.search(r"window\.GAME_DATA\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not m:
        sys.exit("data/game-data.js 형식을 읽을 수 없습니다.")
    data = json.loads(m.group(1))
    lines = dict(data["lines"])
    for p in data["level1"] + data["level2"]:
        lines[p["id"]] = p["say"]
    # 숫자 문장: w-3200 = "삼천 이백 원"(금액 카드), n-3200 = "삼천 이백"(함께 세기),
    #           sum-3200 = "모두 삼천 이백 원이에요."
    for n in range(100, 10000, 100):
        lines[f"w-{n}"] = f"{won(n)} 원"
        lines[f"n-{n}"] = won(n)
        lines[f"sum-{n}"] = f"모두 {won(n)} 원이에요."
    return lines


DIGIT = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]


def won(n):
    """3200 -> '삼천 이백' (js/money.js 의 won() 과 같은 읽기)"""
    th, h = n // 1000, n % 1000 // 100
    parts = []
    if th:
        parts.append(("" if th == 1 else DIGIT[th]) + "천")
    if h:
        parts.append(("" if h == 1 else DIGIT[h]) + "백")
    return " ".join(parts)


def post_json(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def tts_edge(text, out_base, args):
    try:
        import asyncio
        import edge_tts
    except ImportError:
        sys.exit("edge-tts 가 필요합니다: pip install edge-tts")
    out = out_base.with_suffix(".mp3")

    async def run():
        await edge_tts.Communicate(text, args.voice or "ko-KR-SunHiNeural", rate="-5%", pitch="+5Hz").save(str(out))
    asyncio.run(run())
    return out.name


def tts_elevenlabs(text, out_base, args):
    key = os.environ.get("ELEVENLABS_API_KEY") or sys.exit("ELEVENLABS_API_KEY 환경변수가 필요합니다.")
    voice_id = ELEVEN_VOICES.get(args.voice, args.voice)
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
    body = {
        "text": text,
        "model_id": args.model or "eleven_multilingual_v2",
        "language_code": "ko",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.35, "speed": 0.95},
    }
    audio = post_json(url, body, {"xi-api-key": key, "Accept": "audio/mpeg"})
    out = out_base.with_suffix(".mp3")
    out.write_bytes(audio)
    return out.name


def tts_gemini(text, out_base, args):
    key = os.environ.get("GEMINI_API_KEY") or sys.exit("GEMINI_API_KEY 환경변수가 필요합니다.")
    model = args.model or "gemini-3.1-flash-tts-preview"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    prompt = ("초등학교 특수학급 아이들에게 말하듯 밝고 다정하게, 또박또박 천천히 읽어 주세요: " + text)
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": args.voice or "Kore"}}},
        },
    }
    res = json.loads(post_json(url, body, {"x-goog-api-key": key}))
    pcm = base64.b64decode(res["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    out = out_base.with_suffix(".wav")
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(pcm)
    return out.name


def write_manifest(provider, files):
    MANIFEST.write_text(
        "/* 녹음된 음성 파일 목록 — tools/generate_audio.py 가 자동으로 다시 씁니다.\n"
        " * files 가 비어 있으면 브라우저 내장 음성(자연스러운 한국어 음성 자동 선택)을 사용합니다. */\n"
        "window.AUDIO_CLIPS = " + json.dumps({"provider": provider, "files": files}, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="나래 짝꿍 카드 음성 파일 생성")
    ap.add_argument("--provider", choices=["edge", "elevenlabs", "gemini"], default="edge")
    ap.add_argument("--voice", default=None, help="edge: ko-KR-SunHiNeural 등 / ElevenLabs: Yuna 또는 voice_id / Gemini: Kore 등")
    ap.add_argument("--model", default=None)
    ap.add_argument("--only", nargs="*", help="특정 문장 id 만 다시 만들기")
    ap.add_argument("--reset", action="store_true", help="녹음 파일 삭제 후 브라우저 음성으로 되돌리기")
    args = ap.parse_args()

    if args.reset:
        for f in AUDIO_DIR.iterdir():
            if f.suffix in (".mp3", ".wav"):
                f.unlink()
        write_manifest(None, {})
        print("녹음 파일을 지웠습니다. 이제 브라우저 음성을 사용합니다.")
        return

    if args.provider == "elevenlabs" and not args.voice:
        args.voice = "Yuna"
    fn = {"edge": tts_edge, "elevenlabs": tts_elevenlabs, "gemini": tts_gemini}[args.provider]

    lines = load_lines()
    files = {}
    for i, (lid, text) in enumerate(lines.items(), 1):
        existing = [f for f in AUDIO_DIR.glob(lid + ".*") if f.suffix in (".mp3", ".wav")]
        if existing and not (args.only and lid in args.only):
            files[lid] = existing[0].name
            continue
        if args.only and lid not in args.only:
            continue
        print(f"[{i}/{len(lines)}] {lid}: {text}")
        for attempt in range(3):
            try:
                files[lid] = fn(text, AUDIO_DIR / lid, args)
                break
            except Exception as e:  # 네트워크 일시 오류 재시도
                print("   다시 시도:", e)
                time.sleep(2 + attempt * 3)
        else:
            print("   실패 — 이 문장은 브라우저 음성으로 읽습니다.")
    write_manifest(args.provider, files)
    print(f"완료: {len(files)}/{len(lines)}개 음성 파일 → assets/audio/")


if __name__ == "__main__":
    main()
