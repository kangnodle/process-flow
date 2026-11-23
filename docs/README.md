# Process Flow 명세

[요구사항](01-requirements.sdoc)은 현재 동작과 제약을 정의합니다. [설계](02-design.sdoc)는 요구사항을 만족하는 패키지, 상태 전이, 저장 경계와 검증 기준을 설명합니다.

저장소 루트에서 StrictDoc 0.32.1로 HTML을 생성합니다.

```sh
uvx --from strictdoc==0.32.1 strictdoc export docs --output-dir docs/_build
```

`docs/_build/html/index.html`의 **Traceability Matrix**에서 각 `PF-REQ-*` 요구사항과 대응 `PF-DES-*` 설계를 찾을 수 있습니다. 설계의 **Implementation** 링크는 구현으로, **Test** 링크는 해당 동작을 확인하는 테스트 파일로 이어집니다.

## 동작 변경 시

1. 요구사항의 UID를 유지하며 기대 동작을 갱신하고, 새 요구사항에는 고유한 UID를 부여합니다.
2. 설계의 `Parent`를 요구사항 UID에 연결하고, 구현 파일과 기대 결과를 검증하는 테스트 파일의 `File` 관계를 갱신합니다.
3. HTML을 다시 생성해 연결을 확인하고 저장소 루트에서 `mise run check`로 프로젝트를 검증합니다. 테스트만 실행하려면 `(cd backend && cargo test --workspace)`와 `(cd frontend && npm test)`를 사용합니다.
