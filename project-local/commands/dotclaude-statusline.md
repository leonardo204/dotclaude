---
description: "StatusLine HUD on/off 토글"
allowed-tools: [Bash]
---

StatusLine HUD 토글 명령

## 인자 처리

- `$ARGUMENTS`를 확인한다
- `on` → HUD 활성화 (플래그 파일 삭제)
- `off` → HUD 비활성화 (플래그 파일 생성)
- 인자 없음 → 현재 상태의 반대로 토글

## 실행

아래 bash 명령을 **한 번에** 실행하고 결과만 보고한다. 사용자에게 확인을 묻지 않는다.

```bash
FLAG=~/.claude/.hud_disabled
ARG="$ARGUMENTS"

if [ "$ARG" = "on" ]; then
  rm -f "$FLAG"
  echo "StatusLine HUD: ON"
elif [ "$ARG" = "off" ]; then
  touch "$FLAG"
  echo "StatusLine HUD: OFF"
else
  # 토글
  if [ -f "$FLAG" ]; then
    rm -f "$FLAG"
    echo "StatusLine HUD: OFF → ON"
  else
    touch "$FLAG"
    echo "StatusLine HUD: ON → OFF"
  fi
fi
```
