"""Generate native TikZ figures; the report compiles these sources directly."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'figures'
DEST.mkdir(exist_ok=True)
GENERATED = []

def esc(s):
    return s.replace('_', r'\_').replace('&', r'\&').replace('%', r'\%')

def save(name, lines):
    (DEST / (name + '.tex')).write_text('\n'.join(lines) + '\n', encoding='utf-8')
    GENERATED.append(name)

BASE = r'\begin{tikzpicture}[x=1cm,y=1cm,>=Latex,line width=0.8pt,font=\linespread{1}\fontsize{10.5}{13}\selectfont]'

def cls(name, xy, title, attrs, ops, width=5.8, stereotype='entity'):
    x,y = xy
    type_map={'文本':'string','日期':'Date','时刻':'DateTime','金额':'decimal','数值':'decimal','布尔':'bool','可选时刻':'DateTime [0..1]','时段':'TimeRange','预约阶段':'AppointmentStage','订单阶段':'OrderStage','支付结果':'PaymentResult'}
    def attribute(a):
        if '：' in a:
            prop,typ=a.rsplit('：',1)
            return esc(prop)+': '+type_map.get(typ,esc(typ))
        return esc(a)
    def operation(o):
        returns={'识别或登记':'Patient','核对身份':'bool','确认':'ReservationResult','汇总履约':'Metric','检查可接诊':'bool','列出有效预约':'Appointment[*]','检查可使用':'bool','确认可开单':'bool','开立收费单':'Bill','拟定':'Bill','计算应收':'decimal','汇总回收':'Metric','确认可收费':'bool','给出计价依据':'decimal','计算行金额':'decimal','给出有效入账额':'decimal','校验适用':'bool','确认可委托':'bool','发送':'OrderCopy','受理回执':'ReceiptResult','汇总交付':'Metric','列出待处理':'Order[*]','判断到期':'bool'}
        return esc(o)+r': \mbox{'+returns.get(o.split('(')[0],'void')+'}'
    attrs=[a for item in attrs for a in item.split('；')]
    ops=[o for item in ops for o in item.split('；')]
    return (rf'\node[draw,fill=white,inner sep=0pt] ({name}) at ({x},{y}) {{'
            rf'\begin{{tabular}}{{@{{\hspace{{5pt}}}}>{{\raggedright\arraybackslash}}p{{{width}cm}}@{{\hspace{{5pt}}}}}}'
            rf'\centering\bfseries {title}\tabularnewline\hline '
            + r'\rule{0pt}{14pt}' + r'\newline '.join('- ' + attribute(a) for a in attrs)
            + r'\tabularnewline\hline\rule{0pt}{14pt}'
            + r'\newline '.join('+ ' + operation(o) for o in ops)
            + r'\tabularnewline\end{tabular}};')

def link(a,b,ends=('1','0..*'),label='',path='--',style=''):
    # Endpoint cardinalities have independent white backgrounds and offsets.
    vertical=(a.endswith('.south') and b.endswith('.north')) or (a.endswith('.north') and b.endswith('.south'))
    where='left' if vertical else 'above'
    labelwhere='right' if vertical else 'below'
    return (rf'\draw[{style}] ({a}) {path} '
            rf'node[pos=0.14,{where},fill=white,inner sep=1pt] {{{ends[0]}}} '
            rf'node[pos=0.86,{where},fill=white,inner sep=1pt] {{{ends[1]}}} '
            + (rf'node[midway,{labelwhere},fill=white,inner sep=1pt] {{{label}}} ' if label else '')
            + rf'({b});')

# Patient/appointment classes: relationships use UML multiplicities, not FK attributes.
v=[BASE,
cls('patient',(-4.25,0),'患者',['姓名：文本','出生日期：日期','联系方式：文本','重要提示：文本'],['识别或登记(身份资料)','更新联系方式(联系方式)','核对身份(身份资料)']),
cls('appointment',(4.25,0),'预约',['开始时间、结束时间：时刻','预约类型、主诉：文本','当前阶段：预约阶段'],['确认(患者、医生、诊室、时段)','改约(新时段、原因)','取消(原因)；登记到诊()','汇总履约(期间)']),
cls('doctor',(-4.25,-5.3),'医生',['姓名：文本','可接诊：布尔'],['检查可接诊(时段)','列出有效预约(时段)']),
cls('room',(4.25,-5.3),'诊室',['名称：文本','可使用：布尔'],['检查可使用(时段)','列出有效预约(时段)']),
cls('encounter',(-4.25,-10.5),'诊疗',['发生时间：时刻','主诉、诊断、处理意见：文本'],['记录诊疗(诊疗内容)','确认可开单()','开立收费单(项目集合)']),
cls('history',(4.25,-10.5),'预约变更',['原时段、新时段：时段','变更时间：时刻','原因、操作人：文本'],['记载变更(变更内容)']),
link('patient.east','appointment.west',('1','0..*'),'预约'),
link('patient.south','doctor.north',('0..*','0..*'),'接诊',style='dashed'),
link('appointment.south','room.north',('0..*','1'),'占用'),
rf'\draw (patient.west) -- (-7.7,0) -- (-7.7,-10.5) -- (encounter.west);\node[fill=white,inner sep=1pt] at (-7.7,-1.6) {{1}};\node[fill=white,inner sep=1pt] at (-7.7,-9) {{0..*}};',
link('doctor.south','encounter.north',('1','0..*'),'负责'),
link('encounter.east','history.west',('',''),'',style='draw=none'),
link('appointment.south west','doctor.north east',('0..*','1'),'接诊'),
rf'\draw[{{Diamond[fill=black,length=7pt,width=5pt]}}-] (appointment.east) -- (7.8,0) -- (7.8,-10.5) -- (history.east);',
rf'\node[fill=white,inner sep=1pt] at (7.8,-2.0) {{1}};\node[fill=white,inner sep=1pt] at (7.8,-9.0) {{0..*}};',
rf'\draw (appointment.south west) -- (0.55,-2.7) -- (0.55,-10.5) -- (encounter.east);',
rf'\node[fill=white,inner sep=1pt] at (0.55,-4.4) {{0..1}};\node[fill=white,inner sep=1pt] at (0.55,-9.4) {{0..1}};',
r'\end{tikzpicture}']
# Avoid an invented persistent doctor-patient association: encounters link them.
v=[s for s in v if not ('patient.south) -- ' in s and 'doctor.north' in s)]
save('07_classes_appointment',v)

v=[BASE,
cls('encounter',(-4.25,0),'诊疗',['发生时间：时刻','主诉、诊断：文本'],['开立收费单(项目集合)']),
cls('bill',(4.25,0),'收费单',['开单时间：时刻','合法折扣：金额','/应收、/已收、/欠款：金额'],['拟定(诊疗、项目集合)','计算应收()','应用支付结果(支付、结果)','汇总回收(期间)']),
cls('price',(-4.25,-5.7),'收费项目',['名称、单位：文本','当前单价：金额','是否有效：布尔'],['确认可收费()','给出计价依据()']),
cls('line',(4.25,-5.7),'收费明细',['项目名称、单位：文本','数量：数值','成交单价、项目折扣：金额'],['计算行金额()']),
cls('payment',(-4.25,-11.2),'支付',['请求号、外部交易号：文本','金额：金额；发生时间：时刻','当前结果：支付结果'],['登记尝试(金额、请求号)','确认结果(回执)','给出有效入账额()']),
cls('debt',(4.25,-11.2),'欠款',['形成日期、到期日：日期','结清时间：可选时刻','/余额：金额'],['复核余额(收费单)','登记结清()']),
link('encounter.east','bill.west',('1','0..*'),'开立'),
link('bill.south','line.north',('1','1..*'),'包含',style='{Diamond[fill=black,length=7pt,width=5pt]}-'),
link('price.east','line.west',('1','0..*'),'计价来源'),
link('bill.east','debt.east',('1','0..1'),'',path='-- ++(1,0) |-'),
rf'\draw[{{Diamond[fill=black,length=7pt,width=5pt]}}-] (bill.west) -- (0,-1) -- (0,-8.6) -- (payment.north east);',
rf'\node[fill=white] at (0,-2.5) {{1}};\node[fill=white] at (-1.0,-8.6) {{0..*}};',
r'\end{tikzpicture}']
save('08_classes_billing',v)

v=[BASE,
cls('product',(-4.25,0),'产品',['名称、材料、单位：文本','是否有效：布尔'],['校验适用(修复要求)']),
cls('lab',(4.25,0),'技工所',['名称、联系方式：文本','是否合作：布尔'],['确认可委托()']),
cls('order',(-4.25,-6.2),'义齿订单',['颜色、盒色：文本','数量：数值；承诺日期：日期','当前阶段：订单阶段','预计完成时间：可选时刻'],['保存草稿(修复要求)','发送()；确认发送结果(结果)','受理回执(回执)','登记试戴(结论)','确认交货()；申请返工(原因)','汇总交付(期间)','列出待处理(期间)']),
cls('event',(4.25,-6.2),'订单进展',['发生时间：时刻','原阶段、新阶段：订单阶段','来源、事件号、原因：文本'],['记载进展(变更内容)']),
cls('tooth',(-4.25,-12.0),'订单牙位',['牙位编码：文本'],['核对牙位()']),
cls('reminder',(4.25,-12.0),'提醒',['类型、收件人：文本','计划时间：时刻','发送结果：文本','发送时间：可选时刻'],['排定(目标、时间、收件人)','按承诺日期排定()','判断到期(当前时间)','确认发送(发送结果)']),
link('product.south','order.north',('1','0..*'),'选用'),
rf'\draw (lab.west) -- (0,0) -- (0,-2.2) -- (order.north east);\node[fill=white] at (0.9,0) {{1}};\node[fill=white] at (-0.5,-2.2) {{0..*}};',
link('order.east','event.west',('1','1..*'),'留痕',style='{Diamond[fill=black,length=7pt,width=5pt]}-'),
link('order.south','tooth.north',('1','0..*'),'修复牙位',style='{Diamond[fill=black,length=7pt,width=5pt]}-'),
link('event.south','reminder.north',('',''),'',style='draw=none'),
link('order.south east','reminder.north west',('0..1','0..*'),'排定',style='{Diamond[fill=black,length=7pt,width=5pt]}-'),
r'\end{tikzpicture}']
save('09_classes_order',v)

# People and organizations reuse the exact circled symbols from figures 2 and 3.
# Software object heads retain their boundary/control/entity notation.
def seq(name, participants, steps, notes=(), time_scale=1.0):
    xs=[i*2.64 for i in range(len(participants))]
    out=[BASE, r'\tikzset{every node/.append style={font=\sffamily\fontsize{10.5}{12.5}\selectfont}}']
    def timeline(y):
        # Compress message gaps only; symbol geometry and font sizes stay fixed.
        return 1.9+(y-1.9)*time_scale
    bottom=timeline(max(s[0] for s in steps)+1.1)
    for i,(label,kind) in enumerate(participants):
        x=xs[i]
        if kind=='actor':
            out += [rf'\pic at ({x},0.66) {{reference-worker}};']
        elif kind=='organization':
            out += [rf'\pic at ({x},0.935) {{reference-organization}};']
        else:
            out += [rf'\draw ({x},.42) circle (.24);']
            if kind=='boundary':out += [rf'\draw ({x-.4},.15)--({x-.4},.69);\draw ({x-.4},.42)--({x-.24},.42);']
            elif kind=='control':out += [rf'\draw[-{{Latex[length=4pt]}}] ({x+.24},.42) arc (0:120:.24);']
            elif kind=='entity':out += [rf'\draw ({x-.3},.18)--({x+.3},.18);']
        label=r'\\'.join(r'\underline{'+esc(t)+'}' if kind not in ('actor','organization') else esc(t) for t in label.split('|'))
        out += [rf'\node[align=center,text width=2.5cm,font=\sffamily\fontsize{{10.5}}{{12.5}}\selectfont] at ({x},-.55) {{{label}}};',
                rf'\draw[densely dashed] ({x},-1.15)--({x},{-bottom});']
    intervals={i:[] for i in range(len(xs))}
    for k,(y,a,b,label,kind) in enumerate(steps):
        if kind!='call' or participants[b][1] in ('actor','organization'):continue
        end=y+.5
        for ny,na,nb,nlabel,nkind in steps[k+1:]:
            if na==a and nb==b and nkind=='call':break
            if na==b and nb==a:
                end=ny+.08
                break
        intervals[b].append((y-.08,end))
    for b,spans in intervals.items():
        merged=[]
        for a,z in spans:
            if merged and a<=merged[-1][1]:merged[-1]=(merged[-1][0],max(z,merged[-1][1]))
            else:merged.append((a,z))
        for a,z in merged:
            out += [rf'\draw[fill=white] ({xs[b]-.055},{-timeline(a)}) rectangle ({xs[b]+.055},{-timeline(z)});']
    for y,a,b,label,kind in steps:
        ya=-timeline(y); xa=xs[a];xb=xs[b]
        if kind=='self':
            out += [rf'\draw[-{{Latex[length=5pt]}}] ({xa},{ya}) -- ({xa+.65},{ya}) -- ({xa+.65},{ya-.45}) -- ({xa},{ya-.45});',
                    rf'\node[anchor=west,align=left,fill=white,text width=2.8cm,inner sep=2pt] at ({xa+.72},{ya-.21}) {{{esc(label)}}};']
            continue
        style='-{Latex[length=5pt,width=4pt]}' if kind=='call' else 'dashed,-{Straight Barb[length=5pt]}'
        distance=abs(xa-xb)
        # More than one line is reserved in the event grid, keeping arrows legible.
        out += [rf'\draw[{style}] ({xa},{ya}) -- ({xb},{ya}) node[midway,above=2pt,align=center,fill=white,inner sep=1.5pt,text width={max(2.5,distance-.25):.2f}cm] {{{esc(label)}}};']
    for y,text in notes:
        out += [rf'\node[draw,fill=white,align=left,text width={xs[-1]-.5}cm,inner sep=5pt,anchor=north] at ({xs[-1]/2},{-timeline(y)}) {{{text}}};']
    out += [r'\end{tikzpicture}']
    save(name,out)

seq('10_sequence_appointment',[
('前台接待','actor'),(':前台接口','boundary'),(':登记预约|控制','control'),(':患者','entity'),(':预约','entity'),(':消息服务|接口','boundary')],[
(1.9,0,1,'1 提交身份与预约要求','call'),
(3.0,1,2,'2 登记预约(要求)','call'),
(4.1,2,3,'3 识别或登记(身份资料)','call'),
(5.1,3,2,'患者核对结果','return'),
(6.2,2,4,'4 确认(患者、医生、诊室、时段)','call'),
(7.1,4,4,'5 检查时段()','self'),
(8.5,4,2,'预约编号 / 冲突原因','return'),
(9.8,2,5,'6 [确认成功]发送预约通知(预约)','call'),
(10.9,5,2,'发送结果','return'),
(12.0,2,1,'7 反馈预约或冲突','call'),
(13.1,1,0,'显示处理结果','return')],[(14.0,r'冲突分支：第 5 步失败即结束确认，不发送通知；改约沿用相同检查并新增预约变更。通知失败保留已确认预约，登记重试任务。')])

seq('11_sequence_billing',[
('收费员','actor'),(':收费接口','boundary'),(':录入收费|控制','control'),(':收费单','entity'),(':支付','entity'),(':支付服务|接口','boundary')],[
(1.9,0,1,'1 确认收费项目与金额','call'),
(3.0,1,2,'2 录入收费(诊疗、项目)','call'),
(4.1,2,3,'3 拟定(诊疗、项目集合)','call'),
(5.1,3,3,'4 计算应收()','self'),
(6.7,3,4,'5 登记尝试(金额、请求号)','call'),
(7.5,3,2,'收费单与支付请求','return'),
(8.6,2,5,'6 发起支付(请求号、金额)','call'),
(9.7,5,2,'成功 / 失败 / 待确认','return'),
(10.8,2,3,'7 应用支付结果(支付、结果)','call'),
(11.9,3,4,'8 确认结果(回执)','call'),
(13.0,4,3,'有效入账额','return'),
(14.1,3,2,'凭证、已收与欠款','return'),
(15.2,2,1,'9 展示凭证与余额','call'),
(16.3,1,0,'反馈处理结果','return')],[(17.1,r'成功才计入已收；失败和待确认均不减少欠款。异步结果仍进入“应用支付结果”，重复成功回执不重复入账。欠款由收费单按有效支付合计复核。')])

seq('12_sequence_order_send',[
('口腔医生','actor'),(':医生接口','boundary'),(':录入义齿|订单控制','control'),(':诊疗','entity'),(':义齿订单','entity'),(':技工所|接口','boundary')],[
(1.9,0,1,'1 提交修复要求','call'),
(3.0,1,2,'2 录入订单(修复要求)','call'),
(4.1,2,3,'3 确认可开单()','call'),
(5.1,3,2,'诊疗核对结果','return'),
(6.2,2,4,'4 保存草稿(修复要求)','call'),
(7.1,4,4,'5 核对产品、牙位和附件','self'),
(8.5,4,2,'草稿 / 缺项清单','return'),
(9.7,2,4,'6 [医生确认且校验通过]发送()','call'),
(10.8,4,2,'待发送订单副本','return'),
(11.9,2,5,'7 提供订单(订单副本)','call'),
(13.0,5,2,'已提交 / 待重试','return'),
(14.1,2,4,'8 确认发送结果(结果)','call'),
(15.1,4,2,'订单当前阶段','return'),
(16.2,2,1,'9 反馈发送结果','call'),
(17.3,1,0,'显示订单号及当前阶段','return')],[(18.1,r'缺项时停留草稿。发送失败保留待重试，成功后记录已发送及发送时间；“已发送”不表示技工所已接收。技工所接收结果由下一图处理。')], time_scale=0.94)

seq('13_sequence_order_receipt',[
('技工所','organization'),(':技工所|接口','boundary'),(':录入义齿|订单控制','control'),(':义齿订单','entity'),(':订单进展','entity'),(':提醒','entity')],[
(1.9,0,1,'1 返回订单回执','call'),
(3.0,1,2,'2 处理回执(订单号、事件号)','call'),
(4.1,2,3,'3 受理回执(回执)','call'),
(5.1,3,3,'4 校验回执()','self'),
(6.6,3,4,'5 记载进展(变更)','call'),
(7.8,4,3,'进展已记载','return'),
(8.9,3,5,'6 按承诺日期排定()','call'),
(10.1,5,3,'提醒计划','return'),
(11.3,3,2,'接收、拒收或变更结果','return'),
(12.5,2,1,'7 确认回执处理结果','call'),
(13.6,1,0,'确认收到','return')],[(14.5,r'第 5 步仅处理新事件且迁移合法的回执。重复事件返回既有结果；越级交货、无原因回退或未知订单进入核对。试戴不合格则保留历史并登记返工。')])

seq('14_sequence_statistics',[
('诊所负责人','actor'),(':负责人|接口','boundary'),(':查询统计|与提醒控制','control'),(':预约','entity'),(':收费单','entity'),(':义齿订单','entity')],[
(1.9,0,1,'1 提交期间与业务类型','call'),
(3.0,1,2,'2 查询统计(期间、口径)','call'),
(4.1,2,3,'3 汇总履约(期间)','call'),
(5.2,3,2,'分子、分母、样本与异常','return'),
(6.3,2,4,'4 汇总回收(期间)','call'),
(7.4,4,2,'分子、分母、样本与异常','return'),
(8.5,2,5,'5 汇总交付(期间)','call'),
(9.6,5,2,'分子、分母、样本与异常','return'),
(10.7,2,1,'6 展示指标及明细入口','call'),
(11.8,0,1,'7 选择待处理订单','call'),
(12.9,1,2,'8 查询待处理(期间)','call'),
(14.0,2,5,'9 列出待处理(期间)','call'),
(15.1,5,2,'试戴、逾期与提醒情况','return'),
(16.2,2,1,'10 展示订单明细','call')],[(17.0,r'汇总规则由各实体承担，控制类协调查询。样本量为零时显示“无可计算样本”；通知发送通过消息服务接口，发送结果由提醒对象留存。')])

# Logical database schema. All foreign keys point to documented tables/columns.
# Row tuple: key marker, column name, logical SQL type (question mark = nullable).
SCHEMA={
'patient':('患者', [('PK','id','BIGINT'),('UK','patient_no','VARCHAR(32)'),('','name','VARCHAR(80)'),('','birth_date','DATE ?'),('','phone','VARCHAR(32) ?'),('','important_note','TEXT ?')]),
'employee':('员工', [('PK','id','BIGINT'),('UK','employee_no','VARCHAR(32)'),('','name','VARCHAR(80)'),('','role_code','VARCHAR(24)'),('','active','BOOLEAN')]),
'clinic_room':('诊室', [('PK','id','BIGINT'),('UK','room_code','VARCHAR(24)'),('','name','VARCHAR(60)'),('','active','BOOLEAN')]),
'appointment':('预约', [('PK','id','BIGINT'),('UK','appointment_no','VARCHAR(32)'),('FK','patient_id','BIGINT'),('FK','doctor_id','BIGINT'),('FK','room_id','BIGINT'),('FK','created_by','BIGINT'),('','starts_at','TIMESTAMP'),('','ends_at','TIMESTAMP'),('','type_code','VARCHAR(24)'),('','stage','VARCHAR(24)')]),
'appointment_event':('预约变更', [('PK','id','BIGINT'),('FK','appointment_id','BIGINT'),('FK','changed_by','BIGINT'),('','old_start / new_start','TIMESTAMP ?'),('','old_end / new_end','TIMESTAMP ?'),('','old_stage / new_stage','VARCHAR(24)'),('','reason','TEXT ?'),('','occurred_at','TIMESTAMP')]),
'encounter':('诊疗', [('PK','id','BIGINT'),('FK','patient_id','BIGINT'),('FK','doctor_id','BIGINT'),('FK/UK','appointment_id','BIGINT ?'),('','occurred_at','TIMESTAMP'),('','chief_complaint','TEXT'),('','diagnosis','TEXT ?'),('','treatment_note','TEXT ?')]),
'price_item':('收费项目', [('PK','id','BIGINT'),('UK','item_code','VARCHAR(32)'),('','name / unit','VARCHAR(80)'),('','unit_price','DECIMAL(12,2)'),('','active','BOOLEAN')]),
'bill':('收费单', [('PK','id','BIGINT'),('UK','bill_no','VARCHAR(32)'),('FK','encounter_id','BIGINT'),('FK','issued_by','BIGINT'),('','discount_amount','DECIMAL(12,2)'),('','issued_at','TIMESTAMP')]),
'bill_line':('收费明细', [('PK','id','BIGINT'),('FK','bill_id','BIGINT'),('FK','price_item_id','BIGINT'),('FK','dental_order_id','BIGINT ?'),('','item_name / unit','VARCHAR(80)'),('','quantity','DECIMAL(10,2)'),('','unit_price','DECIMAL(12,2)'),('','discount_amount','DECIMAL(12,2)')]),
'payment':('支付', [('PK','id','BIGINT'),('FK','bill_id','BIGINT'),('UK','request_no','VARCHAR(64)'),('UK','external_txn_no','VARCHAR(96) ?'),('','kind / result','VARCHAR(24)'),('','amount','DECIMAL(12,2)'),('','method_code','VARCHAR(24)'),('FK','refund_of_id','BIGINT ?'),('','occurred_at','TIMESTAMP')]),
'receivable':('欠款', [('PK','id','BIGINT'),('FK/UK','bill_id','BIGINT'),('','opened_at','TIMESTAMP'),('','due_date','DATE ?'),('','cleared_at','TIMESTAMP ?')]),
'product':('产品', [('PK','id','BIGINT'),('UK','product_code','VARCHAR(32)'),('','name / material','VARCHAR(80)'),('','unit','VARCHAR(24)'),('','active','BOOLEAN')]),
'dental_lab':('技工所', [('PK','id','BIGINT'),('UK','lab_code','VARCHAR(32)'),('','name','VARCHAR(120)'),('','contact / phone','VARCHAR(80)'),('','active','BOOLEAN')]),
'dental_order':('义齿订单', [('PK','id','BIGINT'),('UK','order_no','VARCHAR(32)'),('FK','encounter_id','BIGINT'),('FK','product_id','BIGINT'),('FK','lab_id','BIGINT'),('FK','created_by','BIGINT'),('','color / order_type','VARCHAR(32)'),('','unit','VARCHAR(24)'),('','quantity','DECIMAL(10,2)'),('','promised_date','DATE'),('','stage','VARCHAR(24)'),('','expected_at','TIMESTAMP ?'),('','sent_at / delivered_at','TIMESTAMP ?')]),
'order_tooth':('订单牙位', [('PK/FK','order_id','BIGINT'),('PK','tooth_code','VARCHAR(8)')]),
'order_event':('订单进展', [('PK','id','BIGINT'),('FK/UK*','order_id','BIGINT'),('UK*','source / event_no','VARCHAR(64)'),('FK','changed_by','BIGINT ?'),('','old_stage / new_stage','VARCHAR(24)'),('','reason','TEXT ?'),('','occurred_at','TIMESTAMP')]),
'order_attachment':('订单附件', [('PK','id','BIGINT'),('FK','order_id','BIGINT'),('','file_name','VARCHAR(180)'),('','storage_key','VARCHAR(240)'),('','mime_type','VARCHAR(80)'),('','byte_size','BIGINT'),('','uploaded_at','TIMESTAMP')]),
'reminder':('订单提醒', [('PK','id','BIGINT'),('FK/UK*','order_id','BIGINT'),('UK*','kind','VARCHAR(24)'),('UK*','scheduled_at','TIMESTAMP'),('UK*','recipient','VARCHAR(120)'),('','delivery_result','VARCHAR(24)'),('','sent_at','TIMESTAMP ?')]),
}

def replace_fields(table, replacements):
    title,rows=SCHEMA[table]
    new=[]
    for row in rows:
        new.extend(replacements.get(row[1],[row]))
    SCHEMA[table]=(title,new)

replace_fields('patient',{'important_note':[('','important_note','TEXT ?'),('FK','created_by','BIGINT'),('','created_at','TIMESTAMP')]})
replace_fields('employee',{'role_code':[]})
replace_fields('clinic_room',{'room_code':[('UK','room_code','VARCHAR(24)'),('FK','clinic_id','BIGINT')]})
replace_fields('appointment',{'type_code':[('FK','type_id','BIGINT'),('','chief_complaint','TEXT ?')]})
replace_fields('encounter',{'patient_id':[('FK','patient_id','BIGINT'),('FK','clinic_id','BIGINT')]})
replace_fields('price_item',{'name / unit':[('','name','VARCHAR(80)'),('FK','unit_id','BIGINT')]})
replace_fields('product',{'unit':[('FK','unit_id','BIGINT')]})
replace_fields('dental_order',{'color / order_type':[('FK','color_id','BIGINT'),('FK','type_id','BIGINT'),('FK','box_color_id','BIGINT ?')],'unit':[('FK','unit_id','BIGINT')]})
replace_fields('dental_order',{'sent_at / delivered_at':[('','dispatch_result','VARCHAR(24)'),('','sent_at','TIMESTAMP ?'),('','delivered_at','TIMESTAMP ?')]})
replace_fields('order_attachment',{'file_name':[('FK','type_id','BIGINT'),('','file_name','VARCHAR(180)')]})
SCHEMA['basic_option']=('基础选项', [('PK','id','BIGINT'),('UK*','kind','VARCHAR(24)'),('UK*','code','VARCHAR(32)'),('','name','VARCHAR(80)'),('','active','BOOLEAN')])
SCHEMA['clinic']=('医院与诊所', [('PK','id','BIGINT'),('UK','clinic_code','VARCHAR(32)'),('','name','VARCHAR(120)'),('','address','VARCHAR(240) ?'),('','phone','VARCHAR(32) ?'),('','active','BOOLEAN')])
SCHEMA['employee_role']=('员工岗位', [('PK/FK','employee_id','BIGINT'),('PK','role_code','VARCHAR(24)')])
replace_fields('reminder',{'order_id':[('FK/UK*','order_id','BIGINT ?'),('FK/UK*','appointment_id','BIGINT ?')]})
SCHEMA['reminder']=('提醒',SCHEMA['reminder'][1])
# Each name becomes its own atomic column in the final diagrams.
for table,(title,rows) in list(SCHEMA.items()):
    SCHEMA[table]=(title,[(key,name.strip(),typ) for key,col,typ in rows for name in col.split('/')])

def dbnode(table,xy,width=6.3,ref=False):
    title,rows=SCHEMA[table]
    if ref: rows=[('PK','id','BIGINT')]
    position=rf'({xy[0]},{xy[1]})' if isinstance(xy,tuple) else xy
    # A single fixed-width box prevents text spilling beyond table borders.
    lines=[rf'\node[draw,fill=white,inner sep=0pt,anchor=north] ({table}) at {position} {{\begin{{minipage}}{{{width}cm}}',
    rf'\centering\rule{{0pt}}{{15pt}}\textbf{{{esc(table)}}}（{title}{"，引用" if ref else ""}）\par\vspace{{2pt}}\hrule\vspace{{3pt}}',
    r'\raggedright\fontsize{9.5}{12.3}\selectfont\setlength{\tabcolsep}{2pt}\renewcommand{\arraystretch}{1.02}',
    r'\begin{tabular}{@{}>{\raggedright\arraybackslash}p{1.05cm}>{\raggedright\arraybackslash}p{2.64cm}>{\raggedright\arraybackslash}p{2.32cm}@{}}']
    for key,col,typ in rows:
        rendered_type=esc(typ[:-2])+r'\textsuperscript{?}' if typ.endswith(' ?') else esc(typ)
        lines.append(rf'{{\fontsize{{7.5}}{{9}}\selectfont {esc(key.replace("/",","))}}} & \texttt{{{esc(col)}}} & {{\sffamily\fontsize{{8.8}}{{11}}\selectfont\mbox{{{rendered_type}}}}} \\')
    lines += [r'\end{tabular}\vspace{4pt}\end{minipage}};']
    return '\n'.join(lines)

def dbedge(a,b,start='east',end='west',ends=('1','0..*'),path='--',label=''):
    offsets={'east':(.33,.23),'west':(-.33,.23),'north':(.30,.28),'south':(.30,-.28),'north west':(-.26,.24),'south east':(.26,-.24),'south west':(-.26,-.24),'north east':(.26,.24)}
    out=[rf'\draw ({a}.{start}) {path} ({b}.{end});']
    for table,anchor,value in [(a,start,ends[0]),(b,end,ends[1])]:
        dx,dy=offsets[anchor]
        out += [rf'\node[fill=white,inner sep=1pt] at ($({table}.{anchor})+({dx},{dy})$) {{{value}}};']
    return '\n'.join(out)

def erd(name,rows,edges,notes=()):
    out=[BASE]
    previous=None
    for i,row in enumerate(rows):
        out += [rf'\coordinate (row{i}) at (0,0);'] if i==0 else [rf'\coordinate (row{i}) at ($({previous}.south)+(0,-1.15)$);']
        names=[]
        for side,item in enumerate(row):
            if item is None: continue
            table,ref=(item,False) if isinstance(item,str) else item
            out += [dbnode(table,rf'([xshift={-4.05 if side==0 else 4.05}cm]row{i})',ref=ref)]
            names.append(f'({table})')
        previous=f'rowfit{i}'
        out += [rf'\node[fit={"".join(names)},inner sep=0pt] ({previous}) {{}};']
    out += edges
    for xy,txt,w in notes:
        out += [rf'\node[draw,fill=white,anchor=north,align=left,text width={w}cm,inner sep=5pt] at {xy} {{{txt}}};']
    out += [r'\end{tikzpicture}']
    save(name,out)

erd('15_erd_appointments',[
('patient','employee'),('appointment','clinic_room'),('appointment_event','encounter')],[
dbedge('patient','appointment','south','north'),
dbedge('clinic_room','appointment','west','east'),
dbedge('appointment','appointment_event','south','north'),
dbedge('employee','encounter','east','east',path='-- ++(.55,0) |-'),
dbedge('appointment','encounter','south east','north west',ends=('0..1','0..1')),
])

erd('16_erd_billing',[
('bill','price_item'),('payment','bill_line'),('receivable',('encounter',True))],[
dbedge('bill','bill_line','east','north west',ends=('1','1..*')),
dbedge('price_item','bill_line','south','north'),
dbedge('bill','payment','south','north'),
dbedge('bill','receivable','west','west',ends=('1','0..1'),path='-- ++(-.55,0) |-'),
dbedge('encounter','bill','west','south east',path='-- (0,0 |- encounter.west) -- (0,0 |- bill.south east) --'),
])

erd('17_erd_orders',[
('product','dental_lab'),('dental_order','order_event'),(('encounter',True),'order_tooth')],[
dbedge('product','dental_order','south','north'),
dbedge('dental_lab','dental_order','south west','north east'),
dbedge('dental_order','order_event','east','west',ends=('1','1..*')),
dbedge('dental_order','order_tooth','south east','west',ends=('1','0..*')),
dbedge('encounter','dental_order','north','south'),
])

erd('18_erd_support',[
('basic_option','clinic'),('order_attachment','reminder'),('employee_role',('dental_order',True))],[
dbedge('basic_option','order_attachment','south','north'),
dbedge('dental_order','reminder','north','south',ends=('0..1','0..*')),
dbedge('dental_order','order_attachment','west','south east'),
])

FOREIGN_KEYS={
    'patient':{'created_by':'employee'},
    'clinic_room':{'clinic_id':'clinic'},
    'appointment':{'patient_id':'patient','doctor_id':'employee','room_id':'clinic_room','created_by':'employee','type_id':'basic_option'},
    'appointment_event':{'appointment_id':'appointment','changed_by':'employee'},
    'encounter':{'patient_id':'patient','clinic_id':'clinic','doctor_id':'employee','appointment_id':'appointment'},
    'price_item':{'unit_id':'basic_option'},
    'bill':{'encounter_id':'encounter','issued_by':'employee'},
    'bill_line':{'bill_id':'bill','price_item_id':'price_item','dental_order_id':'dental_order'},
    'payment':{'bill_id':'bill','refund_of_id':'payment'},
    'receivable':{'bill_id':'bill'},
    'product':{'unit_id':'basic_option'},
    'dental_order':{'encounter_id':'encounter','product_id':'product','lab_id':'dental_lab','created_by':'employee','color_id':'basic_option','type_id':'basic_option','box_color_id':'basic_option','unit_id':'basic_option'},
    'order_tooth':{'order_id':'dental_order'},
    'order_event':{'order_id':'dental_order','changed_by':'employee'},
    'order_attachment':{'order_id':'dental_order','type_id':'basic_option'},
    'reminder':{'order_id':'dental_order','appointment_id':'appointment'},
    'employee_role':{'employee_id':'employee'},
}

def validate_schema():
    for table,(_,rows) in SCHEMA.items():
        names=[col for _,col,_ in rows]
        assert len(names)==len(set(names)),f'Duplicate column in {table}'
        assert any('PK' in key for key,_,_ in rows),f'Missing primary key in {table}'
        declared={col for key,col,_ in rows if 'FK' in key}
        assert declared==set(FOREIGN_KEYS.get(table,{})),f'Unmapped FK in {table}'
        for col,target in FOREIGN_KEYS.get(table,{}).items():
            assert target in SCHEMA and any(name=='id' and 'PK' in key for key,name,_ in SCHEMA[target][1]),f'Missing target of {table}.{col}'
    return len(SCHEMA),sum(len(v) for v in FOREIGN_KEYS.values())

if __name__=='__main__':
    tables,foreign_keys=validate_schema()
    print(f'Validated {tables} tables and {foreign_keys} foreign keys; generated {len(GENERATED)} native TikZ figures in figures/.')
