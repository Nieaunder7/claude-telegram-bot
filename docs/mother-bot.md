# Mother Bot — Multi-Instance Orchestration

Mother Bot은 claude-telegram-bot의 다중 인스턴스를 관리하는 오케스트레이션 봇이다.
기존 `src/` 코드는 일절 수정하지 않으며, git worktree + Zellij + 별도 Telegram 봇 토큰으로 격리된 인스턴스를 구동한다.

## Architecture

```
[사용자] → [Mother Bot (@MotherBot)]
                │
                ├─ /spawn project-a ~/repos/myapp
                │    ① git worktree add → mother/worktrees/project-a/
                │    ② .env 생성 (토큰 풀에서 할당)
                │    ③ bun install
                │    ④ Zellij 세션: claude-project-a
                │
                └─ [Child Bot (@Worker1Bot)] → 별도 Telegram 대화
                     └─ Claude Agent SDK (cwd=~/repos/myapp)
```

각 자식 인스턴스는:
- 독립 프로세스 (Zellij 세션)
- 독립 Telegram 봇 토큰
- 독립 git worktree (코드 복사본)
- 독립 .env (WORKING_DIR, BOT_TOKEN 등)

## Prerequisites

- **Bun** 1.0+ — [Install Bun](https://bun.sh/)
- **Zellij** — `which zellij` 로 확인
- **setsid**, **script** — `which setsid`, `which script` 로 확인 (WSL2/Linux 기본 포함)
- **Telegram 계정** 및 본인의 User ID
  - ID 확인: Telegram에서 [@userinfobot](https://t.me/userinfobot) 에 메시지 전송

## Quick Start

### 1. Telegram 봇 토큰 생성

[@BotFather](https://t.me/BotFather)에서 봇을 생성한다.

1. **Mother Bot용 (1개)**: `/newbot` → 이름/유저명 설정 → 토큰 복사
2. **자식 봇용 (N개)**: `/newbot`으로 원하는 만큼 생성 → 각 토큰 메모
   - 자식 봇 수 = 동시에 실행할 수 있는 최대 인스턴스 수

### 2. 설정 파일 생성

```bash
# Mother Bot 환경 변수
cp mother/.env.example mother/.env
```

`mother/.env` 편집:

```
MOTHER_BOT_TOKEN=<Mother Bot 토큰>
MOTHER_ALLOWED_USERS=<본인 Telegram ID>
DEFAULT_ALLOWED_USERS=<본인 Telegram ID>
OPENAI_API_KEY=<OpenAI 키 (음성 전사용, 없으면 생략 가능)>
```

```bash
# 자식 봇 토큰 풀
cp mother/tokens.example.json mother/tokens.json
```

`mother/tokens.json` 편집:

```json
{
  "tokens": [
    { "token": "자식봇1_토큰", "label": "Worker 1" },
    { "token": "자식봇2_토큰", "label": "Worker 2" }
  ]
}
```

### 3. 실행

```bash
bun run mother        # 일반 실행
bun run mother:dev    # 자동 리로드 (개발용)
```

### 4. Telegram에서 사용

Mother Bot에 메시지를 보내서 인스턴스를 관리한다.

| 순서 | 명령 | 설명 |
|------|------|------|
| 1 | `/tokens` | 토큰 풀 상태 확인 |
| 2 | `/spawn myproject /home/user/repos/myapp` | 인스턴스 생성 |
| 3 | `/list` | 실행 중인 인스턴스 목록 |
| 4 | 자식 봇(@WorkerBot)에 직접 메시지 | Claude와 대화 시작 |
| 5 | `/status myproject` | 상세 상태 확인 |
| 6 | `/stop myproject` | 중지 (워크트리 보존) |
| 7 | `/start myproject` | 재시작 |
| 8 | `/remove myproject` | 완전 삭제 |

## Commands

| 명령 | 설명 |
|------|------|
| `/spawn <name> <working_dir>` | 워크트리 생성 + 토큰 할당 + Zellij 세션 시작 |
| `/stop <name>` | Zellij 세션 종료 (워크트리/토큰 할당 보존) |
| `/start <name>` | 중지된 인스턴스 재시작 (기존 워크트리 재사용) |
| `/remove <name>` | Zellij 종료 + 워크트리 삭제 + 토큰 반환 |
| `/list` | 전체 인스턴스 목록 (Zellij 상태 교차 검증) |
| `/status <name>` | 상세 상태 정보 |
| `/tokens` | 토큰 풀 현황 (총/사용중/가용) |

### 이름 규칙

- 영숫자와 하이픈만 허용: `my-project-1` ✅ / `my project` ❌
- `working_dir`은 절대 경로: `/home/user/repos/myapp` ✅ / `~/repos` ❌

### /stop vs /remove

| | `/stop` | `/remove` |
|---|---------|-----------|
| Zellij 세션 | 종료 | 종료 |
| 워크트리 | 보존 | 삭제 |
| 토큰 할당 | 유지 | 반환 |
| 재시작 가능 | `/start`로 가능 | 불가 (새로 `/spawn` 필요) |

## File Structure

```
mother/
  index.ts               봇 엔트리 + 7개 커맨드 핸들러
  config.ts              .env 로드, 경로 상수, 토큰 풀 로드
  types.ts               Instance, InstanceStore, TokenEntry, TokenPoolConfig
  instances.ts           JSON 파일 기반 인스턴스 CRUD
  worktree.ts            git worktree 생성/삭제, .env 생성, bun install
  zellij.ts              Zellij 세션 시작/종료/상태 조회
  .env.example           Mother bot 설정 템플릿
  tokens.example.json    토큰 풀 템플릿
  instances.json         (런타임 생성, gitignored) 인스턴스 상태
  tokens.json            (사용자 작성, gitignored) 토큰 풀
  worktrees/             (런타임 생성, gitignored) git worktree들
```

## Data Flow

### /spawn

```
1. 인자 검증 (이름 형식, 디렉토리 존재, 중복 확인)
2. 토큰 풀에서 가용 토큰 선택 (instances.json의 사용중 토큰 제외)
3. Bot API로 자식 봇 @username 조회
4. git worktree add mother/worktrees/<name> -b mother/<name> HEAD
5. worktree 내 .env 생성 (BOT_TOKEN, WORKING_DIR, ALLOWED_USERS 등)
6. bun install --cwd <worktree>
7. setsid script -qefc "exec zellij --session claude-<name> -- bun run start" /dev/null
8. 3초 대기 → zellij list-sessions로 세션 생존 확인
9. instances.json에 기록
```

진행 상황은 Telegram 메시지로 실시간 업데이트 (1/5 ~ 5/5).

### /stop

```
1. instances.json에서 조회
2. zellij kill-session claude-<name>
3. instances.json status → "stopped"
```

### /start

```
1. instances.json에서 조회 (stopped 상태 확인)
2. 기존 worktree로 Zellij 세션 재시작
3. instances.json status → "running"
```

### /remove

```
1. 실행 중이면 killSession()
2. git worktree remove --force + prune + branch -D
3. instances.json에서 삭제 (토큰 자동 반환)
```

### /list

```
1. instances.json 전체 로드
2. zellij list-sessions와 교차 검증 → 죽은 세션 상태 업데이트
3. 포맷: 🟢/🔴 이름 → @봇유저명 | 디렉토리 | 생성 시간
```

## Module Details

### config.ts

- `mother/.env`를 `dirname(import.meta.filename)` 기반으로 명시적 파싱 (CWD 무관)
- 기존 환경변수가 있으면 덮어쓰지 않음 (`if (!process.env[key])`)
- `loadTokenPool()`: `readFileSync`로 tokens.json 동기 읽기
- 필수값 미설정시 `process.exit(1)`: MOTHER_BOT_TOKEN, MOTHER_ALLOWED_USERS

### instances.ts

- 모든 CRUD는 `loadInstances()` → 수정 → `saveInstances()` 패턴
- `getAvailableToken()`: instances에 할당된 토큰 Set 생성 → pool에서 미할당 토큰 반환
- 제거된 인스턴스의 토큰은 자동으로 풀에 반환 (instances 목록에서 빠지므로)

### worktree.ts

- `createWorktree()`: `git worktree add <path> -b mother/<name> HEAD`
  - 이름별 고유 브랜치 생성 (detached 대신 named branch 사용)
- `removeWorktree()`: `git worktree remove --force` + `prune` + `branch -D`
- `writeChildEnv()`: 빈 값은 필터링하여 .env에 쓰지 않음

### zellij.ts

- `startSession()`: Zellij는 TTY가 필요하므로 `setsid script -qefc` 조합으로 pseudo-TTY 할당
  - `setsid`: 새 세션 리더로 분리 (부모 프로세스 독립)
  - `script -qefc`: pseudo-TTY 할당 (q=quiet, e=return exit code, f=flush, c=command)
  - `exec zellij`: script 프로세스를 zellij로 교체
  - `Bun.spawn({ detached: true, stdio: "ignore" })` + `proc.unref()`로 완전 분리
- `killSession()`: `zellij kill-session <name>`
- `listSessions()`: `zellij list-sessions` 출력을 ANSI 코드 제거 후 파싱
  - 정규식: `/\x1b\[[0-9;]*m/g` 로 ANSI escape 제거
  - "EXITED" 문자열 포함 여부로 상태 판별

### index.ts

- grammY `bot.use()` 미들웨어로 인증 (MOTHER_ALLOWED_USERS 확인)
- `/start`는 인자 유무로 분기: 없으면 웰컴, 있으면 인스턴스 재시작
- `/spawn`에서 진행 상황을 `editMessageText`로 실시간 업데이트 (1/5 ~ 5/5)

## Known Limitations

### SESSION_FILE 공유 (낮은 위험)

- 모든 자식 인스턴스가 `/tmp/claude-telegram-session.json` 공유
- `session.ts`에서 `WORKING_DIR`로 필터링하므로 기능상 문제 없음
- 동시 쓰기 시 JSON 파손 가능성 있으나, 저장 빈도가 낮아 실제 문제 될 확률 극히 낮음
- 완전 격리하려면 `src/config.ts`에서 SESSION_FILE을 env var로 변경 (3줄 수정)

### Zellij TTY 요구사항

- headless 환경에서 `setsid script -qefc` 조합이 실패할 수 있음
- WSL2에서는 `script` 명령이 `/usr/bin/script` (util-linux)로 정상 동작 확인됨

### 토큰 관리

- 토큰은 수동 관리 (BotFather에서 생성 → tokens.json에 추가)
- `/stop` 시 토큰 할당 유지 — 재시작 시 같은 봇으로 동작
- `/remove` 시 토큰 반환 — 새 인스턴스에 재할당 가능

### Worktree 브랜치

- `mother/<name>` 브랜치가 생성됨 — 실질적으로 main의 스냅샷
- `/remove` 시 브랜치도 삭제 (`branch -D`)
- main에 코드 업데이트 후 worktree에 반영하려면: `git -C mother/worktrees/<name> merge main`

## Troubleshooting

### Mother Bot이 시작되지 않을 때

1. `mother/.env` 파일 존재 및 `MOTHER_BOT_TOKEN` 설정 확인
2. `mother/tokens.json` 파일 존재 확인 (없어도 시작은 됨)
3. `bun run mother` 실행 → 콘솔 에러 메시지 확인

### /spawn 실패 시

1. 토큰 유효성: `curl https://api.telegram.org/bot<TOKEN>/getMe`
2. 디렉토리 존재: `ls <working_dir>`
3. 중복 인스턴스: `cat mother/instances.json`
4. 워크트리 충돌: `git worktree list`, 잔존 시 `git worktree prune`
5. bun install 실패: `bun install --cwd mother/worktrees/<name>` 수동 실행
6. Zellij 실패: `zellij list-sessions`

### 자식 봇이 응답하지 않을 때

1. `zellij list-sessions` — EXITED 상태인지 확인
2. `zellij attach claude-<name>` — 세션 접속하여 에러 확인
3. `cat mother/worktrees/<name>/.env` — 설정 확인
4. `cat /tmp/claude-telegram-audit-<name>.log` — 감사 로그 확인

### Zellij 세션이 시작되지 않을 때

1. `which setsid` — 명령 존재 확인
2. `which script` — `/usr/bin/script` 확인
3. 수동 테스트: `zellij --session test -- echo hello && zellij kill-session test`
4. `setsid script -qefc "exec zellij --session test -- sleep 10" /dev/null &` 후 `zellij list-sessions`

### /stop 후 /start가 실패할 때

1. `zellij list-sessions` — EXITED 상태의 잔존 세션 확인
2. `zellij delete-session claude-<name>` — 죽은 세션 삭제 후 재시도
3. `cat mother/instances.json` — status 필드 확인

### 수동 정리

```bash
# 1. Zellij 세션 모두 종료
zellij list-sessions | grep claude- | awk '{print $1}' | xargs -I{} zellij kill-session {}

# 2. 워크트리 정리
git worktree list
git worktree remove mother/worktrees/<name> --force
git worktree prune

# 3. 브랜치 정리
git branch | grep mother/ | xargs git branch -D

# 4. 인스턴스 상태 초기화
echo '{"instances":[]}' > mother/instances.json
```

## Testing Checklist

1. `bun run typecheck` — 타입 에러 없음
2. `bun run mother` — Mother Bot 시작
3. `/tokens` → 토큰 풀 표시
4. `/spawn test-1 /home/user/repos/some-project` → 전체 흐름 테스트
5. `/list` → 인스턴스 표시 + Zellij 상태 일치
6. 자식 봇에 메시지 전송 → Claude 응답 확인
7. `/stop test-1` → Zellij 종료, 워크트리 보존
8. `/start test-1` → 재시작 확인
9. `/remove test-1` → 완전 삭제 확인
