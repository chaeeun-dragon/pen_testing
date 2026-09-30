"""Build the locally verified, screenshot-based Haeon filming cue sheet PDF."""
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ASSETS = ROOT / 'docs/scenarios/haeon-filming-assets'
ASSETS = PROJECT_ASSETS if PROJECT_ASSETS.exists() else ROOT / 'output/haeon-filming-assets'
OUT = (PROJECT_ASSETS.parent if PROJECT_ASSETS.exists() else ROOT / 'output/pdf') / 'haeon-final-demo-shooting-guide-v1.1.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
FONTS = Path('C:/Windows/Fonts') if Path('C:/Windows/Fonts').exists() else Path('/mnt/c/Windows/Fonts')
pdfmetrics.registerFont(TTFont('Malgun', str(FONTS/'malgun.ttf')))
pdfmetrics.registerFont(TTFont('MalgunBold', str(FONTS/'malgunbd.ttf')))
pdfmetrics.registerFontFamily('Malgun', normal='Malgun', bold='MalgunBold')
W, H = 960, 640
C = canvas.Canvas(str(OUT), pagesize=(W,H))
C.setTitle('해온카드 최종 발표 촬영 가이드 v1.1')
C.setAuthor('해온카드 실습 프로젝트')
INK = HexColor('#163d49'); TEAL = HexColor('#177b6d'); MUTED = HexColor('#617c85')
BG = HexColor('#f0f5f4'); LINE = HexColor('#cfdedd'); ORANGE = HexColor('#b96f45')
page = 0


def para(text, x, top, width, size=11, color=INK, bold=False, leading=None):
    style = ParagraphStyle('body', fontName='MalgunBold' if bold else 'Malgun', fontSize=size,
        leading=leading or size*1.65, textColor=color, wordWrap='CJK', spaceAfter=0)
    p = Paragraph(text, style)
    _, h = p.wrap(width, H)
    if top-h < 33: raise ValueError(f'Page {page} text overflow: {text[:60]} bottom={top-h}')
    p.drawOn(C,x,top-h)
    return top-h


def box(x, y, w, h, fill=Color(1,1,1), border=LINE, radius=10):
    C.setFillColor(fill); C.setStrokeColor(border)
    C.roundRect(x,y,w,h,radius,stroke=1,fill=1)


def start(kicker, title, subtitle=''):
    global page
    if page: C.showPage()
    page += 1
    C.setFillColor(BG); C.rect(0,0,W,H,fill=1,stroke=0)
    C.setFillColor(INK); C.rect(0,H-7,W,7,fill=1,stroke=0)
    para(kicker,36,603,880,9,TEAL,True)
    para(title,36,581,890,26,INK,True,32)
    if subtitle: para(subtitle,36,539,890,10,MUTED)
    C.setStrokeColor(LINE); C.line(36,34,924,34)
    C.setFont('Malgun',8); C.setFillColor(MUTED)
    C.drawString(36,19,'HAEON CARD / 촬영자 전용 / v1.1 / 2026.09.29')
    C.drawRightString(924,19,f'{page:02d}')


def shot(name, x, y, width, height):
    path = ASSETS/name
    iw,ih = Image.open(path).size
    # Crop only the PDF viewport, not the source capture. Keep the relevant evidence
    # readable and omit the full-page browser capture's redundant footer/blank area.
    crops = {'05-receipt.png':(20,267,976,580), '09-card03.png':(15,190,985,550)}
    cx,cy,cw,ch = crops.get(name,(0,0,iw,ih))
    scale = min(width/cw,height/ch)
    dw,dh = cw*scale,ch*scale
    box(x-1,y-1,width+2,height+2,Color(1,1,1),LINE,5)
    left,bottom=x+(width-dw)/2,y+(height-dh)/2
    C.saveState()
    clip=C.beginPath();clip.rect(left,bottom,dw,dh);C.clipPath(clip,stroke=0,fill=0)
    C.drawImage(str(path),left-cx*scale,bottom-(ih-cy-ch)*scale,width=iw*scale,height=ih*scale)
    C.restoreState()


def callout(label,text,x=654,top=294,width=270):
    para(label,x,top,width,9,TEAL,True)
    return para(text,x,top-20,width,11,INK,False,18)


def scene(kicker,title,subtitle,image,actions,narration,check):
    start(kicker,title,subtitle)
    shot(image,36,144,592,367)
    top=506
    for n,text in enumerate(actions,1):
        top=para(f'<b>{n:02d}</b>  {text}',654,top,270,11,INK,False,18)-14
    top=callout('완료 확인',check,top=min(top,328))-20
    callout('녹화 팁','버튼을 누른 뒤 결과가 바뀔 때까지 기다립니다. 토큰·비밀번호·개발자도구는 영상에 담지 않습니다.',top=min(top,205))
    box(36,51,888,74,HexColor('#e2eeeb'),LINE)
    para('읽을 대사',51,111,90,9,TEAL,True)
    para(narration,133,112,772,12,INK,False,19)


start('FINAL PRESENTATION / FILMING GUIDE','해온카드, 화면을 따라가며 촬영하세요.','정상 사용자 → 공격자 관점 → 방어자 대응 → 개선 검증. 약 3~4분 + 보조 실험 40초.')
shot('08-after-comparison.png',36,142,590,372)
para('이번 영상에서 보여줄 것',650,505,272,15,INK,True)
para('<b>주 시연 · HAEON-DIAG-01</b><br/>진단 API에서 제한된 모의 웹쉘로 이어지는 흐름과 합성 자료 20건의 내부 수신, 기존 세션 격리, 새 입력 차단.',650,469,272,12)
para('<b>보조 · CARD-03</b><br/>별도 합성 MySQL 장부에서 동시 승인 경쟁 조건과 행 잠금의 차이를 비교.',650,325,272,12)
para('학생에게 콘솔을 공개하지 않습니다.<br/>콘솔 주소는 촬영 PC의 loopback이며 학생용 도메인으로는 404를 반환합니다.',650,224,272,11,TEAL)
box(36,53,888,69,HexColor('#e2eeeb'),LINE)
para('말하지 않을 것',51,108,110,10,TEAL,True)
para('실제 악성 웹쉘 설치·임의 OS 명령·실제 카드정보 유출을 재현한 것이 아닙니다. 북웨이브 자체 공격과 PG 연동 시나리오는 이번 해온카드 영상에서 실행하지 않습니다.',178,109,726,11)

start('00 / RECORDING SETUP','녹화 버튼을 누르기 전에','현재 PC에는 수정·빌드가 적용된 상태입니다. 다음 촬영에서는 연결 확인 → 상태 초기화 → 로그인 준비부터 시작합니다.')
box(36,261,540,250)
para('미리 열어 둘 브라우저 탭',53,493,500,15,INK,True)
urls=[('A  해온카드 메인','http://127.0.0.1:8090/'),('B  시연 데스크','http://127.0.0.1:8094/'),('C  가맹점','http://127.0.0.1:8090/merchant/'),('D  마이페이지','http://127.0.0.1:8090/mypage'),('E  결과 전용','http://127.0.0.1:8094/filming.html?view=results')]
t=459
for name,url in urls:
    para(name,54,t,142,10,TEAL,True)
    para(f'<link href="{url}" color="#163d49">{url}</link>',207,t,353,10)
    t-=34
para('기존 상세 콘솔은 /index.html로 유지됩니다. 촬영에는 B/E 화면을 권장합니다.',54,282,505,9,MUTED)
para('로그인은 촬영 전 또는 편집으로 제외',608,503,305,15,INK,True)
para('가맹점: <b>labmart / LabMart!2026</b><br/>영향 회원: <b>haeon01 / Haeon!2026</b><br/>비교 회원: <b>haeon02 / Haeon!2026</b><br/><br/>모두 합성 실습 계정입니다. 임의 입력이나 공격 명령을 준비할 필요는 없습니다.',608,466,305,11)
para('미리 지정된 값',608,301,305,13,INK,True)
para('등록 대상: 해온마트<br/>주 시연 자료: 합성 지원 자료 20건<br/>CARD-03: 10만원 한도, 6만원 요청 2건<br/>실행 ID·응답 시간·SHA-256은 실행마다 달라질 수 있습니다.',608,270,305,11)
box(36,65,540,175,HexColor('#123946'),HexColor('#123946'))
para('기동은 촬영 전에 완료',52,222,500,12,HexColor('#a8dfd1'),True)
para('WSL bash에서 프로젝트 경로로 이동한 뒤<br/><b>docker compose --env-file .env up -d --build</b><br/><b>docker compose ps</b>',52,189,500,11,Color(1,1,1))
para('주의: up 없는 docker compose -d --build는 잘못된 명령입니다.<br/>기존 DB를 새로 배포할 때는 011_card03_lab.sql 적용이 별도로 필요합니다.<br/>현재 환경은 적용 완료. 초기화를 위해 down -v를 사용하지 마세요.',52,123,500,9,HexColor('#c4d9dc'))

scene('01 / OPENING · 00:00-00:15','해온카드 메인으로 시작합니다.','탭 A → 탭 B. 사이트가 누구의 서비스인지 먼저 보여줍니다.','01-home.png',[
    '탭 A의 메인 화면을 5초 정도 보여줍니다.',
    '탭 B, 시연 데스크로 전환합니다. “진단 API · 주 시연” 탭을 유지합니다.',
    '가맹점 정상 진단을 보여주기 위해 탭 C로 이동합니다.'
], '“해온카드의 가맹점 결제 연동 진단 기능을 대상으로, 침해 흐름과 대응 후 차단 여부를 확인하겠습니다.”',
    '북웨이브가 아니라 해온카드 화면인지 확인합니다. 공격 터미널은 열지 않아도 됩니다.')

scene('02 / NORMAL BASELINE · 00:15-00:40','가맹점의 정상 사용을 먼저 보여줍니다.','탭 C에서 실제 정상 연결 진단 → 탭 B에서 비교 기준선 기록.','03-merchant-normal.png',[
    '가맹점 계정으로 로그인합니다. 대상은 “해온마트 결제 연동 점검 대상”입니다.',
    '“연결 상태 확인”을 누릅니다. 결과의 정상 상태와 응답 시간을 보여줍니다.',
    '탭 B로 돌아와 “정상 진단”을 누릅니다. 기준선 성공 표시를 기다립니다.'
], '“가맹점은 등록된 대상의 연결 상태만 점검할 수 있습니다. 먼저 정상 요청이 정상 처리되는 기준선을 확보합니다.”',
    '가맹점의 “연결 상태 정상”, 데스크의 “기준선: 정상 진단 성공”. 두 화면의 실행은 별도 요청입니다.')

scene('03 / ATTACKER VIEW · 00:40-01:10','Before: 모의 세션과 자료 이동을 관측합니다.','탭 B에서 Before 실행 → 탭 E에서 결과 설명.','04-before.png',[
    '탭 B의 “Before 실행”을 한 번 누릅니다. 실행이 끝날 때까지 기다립니다.',
    '탭 E로 이동합니다. 왼쪽의 세션 생성 → 20건 조회 → 20건 RECEIVED를 짚습니다.',
    '오른쪽 After는 아직 “미실행”이어야 합니다. 대응은 다음 장면에서 실행합니다.'
], '“실습용 비정상 진단 입력으로 제한된 모의 웹쉘 세션이 생성됐습니다. 합성 자료 20건이 조회되고 내부 수신기에서도 수신됐습니다.”',
    'Before ALERT, 세션 생성, 조회 20건, RECEIVED 20건. ALERT는 탐지이지 자동 차단이 아닙니다.')

scene('04 / EVIDENCE · 01:10-01:30','조회와 수신을 다른 근거로 설명합니다.','탭 E의 “수신 증적 · 실행 ID · 단계별 검증 근거”를 펼칩니다.','05-receipt.png',[
    '하단 수신 증적을 펼칩니다. 필요하면 아래로 스크롤합니다.',
    'Before 실행 ID와 TRANSFER ID, 수신 페이로드 SHA-256을 보여줍니다.',
    '세션 토큰이 담긴 원시 응답 파일이나 개발자도구는 열지 않습니다.'
], '“조회 20건만으로 유출 성공이라고 판단하지 않습니다. 내부 수신기의 RECEIVED와 전송 ID, 건수, 해시 일치를 별도로 확인합니다.”',
    '콘솔은 응답의 실행 ID·전송 ID·건수·해시 형식을 확인합니다. 지원 서비스는 실제 수신 영수증의 해시까지 대조합니다.')

scene('05 / DEFENDER VIEW · 01:30-01:55','대응한 뒤, 같은 세션으로 다시 시도합니다.','탭 B의 “대응 및 재접근 검증” → 탭 E의 기존 세션 격리 결과.','06-containment.png',[
    '탭 B에서 현재 Before 실행의 “대응 및 재접근 검증”을 누릅니다.',
    '탭 E에서 기존 세션의 재조회·재전송이 각각 HTTP 403인지 확인합니다.',
    'CONTAINED와 영향 회원 안내 등록을 보여준 뒤 탭 D로 이동합니다.'
], '“운영자 대응으로 이 실행의 세션을 폐기했습니다. 방금 사용한 같은 세션으로 다시 조회하고 전송해도 모두 403으로 거절됩니다.”',
    '재조회 403 + 재전송 403이 있어야 격리 검증 완료입니다. 세션 폐기 표시만으로 재접근까지 검증됐다고 말하지 않습니다.')

scene('06 / AFFECTED MEMBER · 01:55-02:15','마이페이지의 보호 안내를 보여줍니다.','탭 D. 영향 회원 haeon01로 로그인 또는 새로고침.','07-member-notice.png',[
    '영향 회원으로 로그인해 “보호 안내 / 추가 확인이 필요합니다”를 보여줍니다.',
    '안내가 안 보이면 페이지의 “새로고침”을 누릅니다. Before 실행과 대응을 확인합니다.',
    '“확인했습니다”는 선택 사항입니다. 눌러도 읽음 기록만 남는다고 설명합니다.'
], '“자료 접근이 확인된 합성 회원에게 추가 확인 안내가 등록됐습니다. 실제 문자 발송이나 카드 정지가 아니라, 영향 회원 보호 안내 화면입니다.”',
    '미확인 1건과 카드 이용·로그인 정상 안내. 비교가 필요할 때만 haeon02에 안내가 없음을 별도로 보여줍니다.')

scene('07 / AFTER + REGRESSION · 02:15-02:50','같은 입력은 막고, 정상 진단은 유지합니다.','탭 B의 After 실행 → 탭 E의 최종 비교 화면.','08-after-comparison.png',[
    '탭 B로 돌아와 “After 실행”을 누릅니다. 이전 세션 검증을 마쳐야 활성화됩니다.',
    '탭 E에서 오른쪽 HTTP 403과 뒤 단계의 “미실행”을 설명합니다.',
    '맨 아래 정상 진단 HTTP 200을 함께 보여주고 주 시연을 마칩니다.'
], '“개선된 입력 허용 목록에서는 같은 비정상 입력이 403으로 차단됩니다. 뒤 단계는 실행되지 않았고, 정상 진단은 계속 성공합니다.”',
    'After BLOCKED와 정상 진단 200을 모두 확인합니다. 대응은 기존 세션 격리, After는 미리 구성한 강화 경로 검증입니다.')

scene('08 / CARD-03 SUPPLEMENT · 선택 40초','동시 승인 실험은 별도로 촬영합니다.','탭 B → “02 CARD-03 · 보조 실험” → 동시 승인 Before / After 실행.','09-card03.png',[
    '별도 합성 장부라는 범위 설명을 먼저 보여줍니다. 실행 버튼을 한 번 누릅니다.',
    'Before: 서로 다른 6만원 요청 2건이 각각 과거 10만원 한도를 읽고 총 12만원 승인.',
    'After: 행 잠금 뒤 최신 한도로 재판정해 1건 승인, 1건 거절. 정상·재시도 유지도 확인합니다.'
], '“별도 합성 MySQL 장부에서 경쟁 조건을 재현했습니다. 행 잠금 적용 후에는 한 건만 승인됩니다. 현재 승인 코어나 PG 경유 전체를 공격한 결과는 아닙니다.”',
    'Before 120,000원 / After 60,000원. 어느 거래가 먼저 승인되는지는 달라질 수 있습니다. 숫자는 실제 DB 결과입니다.')

scene('09 / NEXT TAKE','재촬영은 증거 저장 후 초기화합니다.','이번 완료 상태는 확인용으로 남겨 두었습니다. 다음 촬영 전에 직접 초기화하면 됩니다.','10-reset.png',[
    '“증거 JSON ↓”로 현재 결과를 저장합니다. 영상 파일도 먼저 저장합니다.',
    '“시연 상태 초기화” → 안내 확인 → “초기화 실행”을 누릅니다.',
    '가맹점 로그인부터 다시 시작합니다. 정상 결제 데이터와 evidence 파일은 유지됩니다.'
], '재촬영 준비 장면은 최종 영상에서 제외해도 됩니다. 초기화는 실습 상태만 정리하며, 프로젝트 폴더나 Docker 전체 데이터를 삭제하지 않습니다.',
    '실행 이력 없음 / 보호 안내 없음 / 가맹점 재로그인. CARD-03 실험 장부는 증거로 남으며 새 비교는 새 장부로 시작합니다.')

start('10 / ONE-PAGE CUE SHEET','촬영 중에는 이 순서만 따라가세요.','화면 전환은 A 메인 / B 데스크 / C 가맹점 / D 마이페이지 / E 결과 전용.')
rows=[('1','A → B','서비스 소개','해온카드가 대상임을 명시'),('2','C → B','가맹점 정상 연결 → 정상 진단','기준선 성공'),('3','B → E','Before 실행 → 결과 설명','ALERT / 조회 20 / RECEIVED 20'),('4','E','수신 증적 펼치기','TRANSFER ID + SHA-256'),('5','B → E','대응 및 재접근 검증','같은 세션 재조회 403 / 재전송 403'),('6','D','영향 회원 보호 안내','추가 확인 안내 / 읽음 기록의 의미'),('7','B → E','After 실행 → 정상 기능 확인','입력 403 / 후속 미실행 / 정상 200'),('8','B · 선택','CARD-03 보조 실험','격리 장부 / 12만원 → 6만원 승인')]
top=512
for idx,screen,action,check in rows:
    box(36,top-43,888,40,Color(1,1,1),LINE,5)
    para(idx,50,top-10,25,11,TEAL,True)
    para(screen,90,top-10,94,10,INK,True)
    para(action,199,top-10,326,11)
    para(check,534,top-10,371,10,MUTED)
    top-=47
para('영상 끝 문장',36,118,130,12,TEAL,True)
para('“탐지, 기존 세션 격리, 새 입력 차단을 구분했고 정상 진단도 유지됨을 확인했습니다.”',176,120,738,13,INK,True)
para('터미널은 필수가 아닙니다. payment-server-incident-simulation.sh는 이 해온카드 시연에 사용하지 않습니다.',36,70,886,10,MUTED)

start('11 / TROUBLESHOOTING + ROLLBACK','막히면 확인할 것, 되돌릴 때 지킬 것','백업은 이미 만들어 두었습니다. 아래는 복원 실행이 아니라 필요할 때 참고하는 안내입니다.')
para('촬영 중 문제',36,509,405,16,INK,True)
problems=[('이전 콘솔이 뜸','새로고침합니다. 최신 데스크는 127.0.0.1:8094/ 또는 /filming.html입니다.'),('After 버튼 비활성','최근 Before를 선택하고 “대응 및 재접근 검증”을 완료합니다. 구버전 실행은 새 Before부터 시작합니다.'),('20건 조회, 수신은 미확인','성공으로 설명하지 않습니다. 수신기 상태·RECEIVED·전송 ID·해시를 확인하고 다시 검증합니다.'),('502 또는 연결 실패','docker compose ps로 서비스 상태를 봅니다. 관련 서비스를 재생성했다면 게이트웨이 reload/restart로 upstream IP를 갱신합니다.'),('마이페이지 안내가 안 보임','haeon01 로그인, 새로고침, 현재 Before의 대응 여부를 확인합니다. haeon02에는 안내가 없는 것이 정상입니다.')]
t=475
for title,body in problems:
    t=para(title,36,t,400,11,TEAL,True)-5
    t=para(body,36,t,405,10)-13
para('원본 폴더 + 실행 상태 백업',490,509,430,16,INK,True)
para('C:\\study\\docker\\<br/><b>bookwave-haeon-lab-backup-20260929-pre-filming</b>',490,472,430,11)
para('전체 1,273개 파일을 해시 비교로 확인했습니다.<br/>.git / .env / 미커밋 파일 / 당시 evidence 포함.<br/>_runtime에는 해온 DB 덤프와 콘솔 이력이 있습니다.<br/>기존 Docker 이미지도 별도 태그로 보존했습니다.',490,411,430,11)
para('소스 복원 순서',490,315,430,12,TEAL,True)
para('관련 서비스 중지 → 현재 폴더를 별도 이름으로 보관 → 백업을 원래 경로로 복사 → 서비스 재빌드.<br/><br/><b>백업 자체를 이동하거나 덮어쓰지 않습니다.</b><br/>폴더만 교체해도 Docker DB 볼륨은 되돌아가지 않습니다. DB까지 복원하려면 현재 결과를 다시 백업하고 RESTORE.md의 별도 절차를 따릅니다.',490,287,430,11)
para('주의: 원본 nginx 설정으로 복원하면 이전 콘솔 공개 설정도 돌아옵니다. 학생 공개를 계속 막으려면 최신 제한 설정을 유지해야 합니다. 실제 복원 시험은 수행하지 않았습니다.',490,127,430,9,ORANGE)

start('12 / VERIFIED SCOPE','발표 자료와 실제 구현을 이렇게 맞췄습니다.','원본 슬라이드와 보안 가이드는 보존했습니다. 아래 차이는 발표 멘트와 슬라이드 캡션에 반영하세요.')
items=[
('HAEON-DIAG-01','문서의 주 시연 흐름 유지. 고정 실습 입력 → 제한된 세션 → 합성 20건 조회·수신 → 같은 세션 격리 확인 → 새 입력 차단 → 정상 진단 재검증.'),
('CARD-03','현재 승인 코어는 이미 행 잠금 적용 상태. 새 화면은 별도 MySQL 합성 장부의 취약/강화 비교이며, 기존 승인 코어의 취약점 재현 또는 Mock PG 통합시험이라고 발표하지 않음.'),
('검증과 근거','단위 검사 15개, 실제 API 회귀 검사 26개 통과. 장애·재시작 포함 검사 31개 통과. 기존 승인 코어의 승인·거절·동일 키 재시도·키 충돌·위조 결과 필드·인증 거절도 별도 확인.'),
('촬영 화면과 증거','웹 화면은 실제 API 결과를 표시. 공개 JSON에는 세션 토큰 미포함. evidence/console, evidence/receiver, evidence/runs에 근거 보관. 현재 최종 Before/After와 CARD-03 결과를 남겨 둠.'),
('검증 범위 밖','실제 악성코드 설치, 임의 OS 명령, 실제 개인정보·외부 유출, 실제 통지·카드 정지, 모든 후속 방어선 검증, 기존 PG 연동 전체와 북웨이브 공격은 이 수정의 검증 범위가 아님.')]
t=512
for title,body in items:
    h=72 if title in ('CARD-03','검증과 근거') else 66
    box(36,t-h,888,h-6)
    para(title,51,t-16,138,12,TEAL,True)
    para(body,204,t-16,700,10,INK,False,16)
    t-=h+6
para('참조 자료',36,128,120,12,TEAL,True)
para('v0.8_slides.pdf: p.23 주 시나리오 / p.27 Before·After / p.34 정상 기능 유지<br/>security-guide-bookwave-haeon-v1.1.pdf: p.5 해온카드 / p.6 CARD-03 / p.8 통제 검증<br/>동일 보안 가이드 HTML: #haeon / #card03 / #verify. 실제 화면 캡처: 2026.09.29 로컬 실행.',178,130,737,10,MUTED)
C.save()
print(f'Created {OUT} ({page} pages)')
