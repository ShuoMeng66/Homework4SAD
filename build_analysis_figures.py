"""Generate native TikZ sources for the vector PDFs embedded in the report."""
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

BASE = r'\begin{tikzpicture}[x=1cm,y=1cm,>=Latex,line width=0.55pt,font=\linespread{1}\fontsize{10.5}{13}\selectfont]'

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
rf'\draw[{{Diamond[fill=black,length=5.5pt,width=4pt]}}-] (appointment.east) -- (7.8,0) -- (7.8,-10.5) -- (history.east);',
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
link('bill.south','line.north',('1','1..*'),'包含',style='{Diamond[fill=black,length=5.5pt,width=4pt]}-'),
link('price.east','line.west',('1','0..*'),'计价来源'),
link('bill.east','debt.east',('1','0..1'),'',path='-- ++(1,0) |-'),
rf'\draw[{{Diamond[fill=black,length=5.5pt,width=4pt]}}-] (bill.west) -- (0,-1) -- (0,-8.6) -- (payment.north east);',
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
link('order.east','event.west',('1','1..*'),'留痕',style='{Diamond[fill=black,length=5.5pt,width=4pt]}-'),
link('order.south','tooth.north',('1','0..*'),'修复牙位',style='{Diamond[fill=black,length=5.5pt,width=4pt]}-'),
link('event.south','reminder.north',('',''),'',style='draw=none'),
link('order.south east','reminder.north west',('0..1','0..*'),'排定',style='{Diamond[fill=black,length=5.5pt,width=4pt]}-'),
r'\end{tikzpicture}']
save('09_classes_order',v)

# External actors use the course's ordinary UML stick figure.
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
            out += [rf'\pic at ({x},0.385) {{analysis-actor}};']
        else:
            out += [rf'\draw ({x},.42) circle (.24);']
            if kind=='boundary':out += [rf'\draw ({x-.4},.15)--({x-.4},.69);\draw ({x-.4},.42)--({x-.24},.42);']
            elif kind=='control':out += [rf'\draw[-{{Straight Barb[length=2.5pt,width=2.5pt]}}] ({x+.24},.42) arc (0:120:.24);']
            elif kind=='entity':out += [rf'\draw ({x-.3},.18)--({x+.3},.18);']
        label=r'\\'.join(r'\underline{'+esc(t)+'}' if kind!='actor' else esc(t) for t in label.split('|'))
        out += [rf'\node[align=center,text width=2.5cm,font=\sffamily\fontsize{{10.5}}{{12.5}}\selectfont] at ({x},-.55) {{{label}}};',
                rf'\draw[line width=0.4pt,dash pattern=on 3pt off 2pt] ({x},-1.15)--({x},{-bottom});']
    intervals={i:[] for i in range(len(xs))}
    for k,(y,a,b,label,kind) in enumerate(steps):
        if kind!='call' or participants[b][1]=='actor':continue
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
        def active(index):
            return any(start<=y<=end for start,end in intervals[index])
        if kind=='self':
            edge=xa+.055 if active(a) else xa
            out += [rf'\draw[-{{Triangle[length=4pt,width=3.2pt]}}] ({edge},{ya}) -- ({xa+.65},{ya}) -- ({xa+.65},{ya-.45}) -- ({edge},{ya-.45});',
                    rf'\node[anchor=west,align=left,fill=white,text width=2.8cm,inner sep=2pt] at ({xa+.72},{ya-.21}) {{{esc(label)}}};']
            continue
        style='-{Triangle[length=4pt,width=3.2pt]}' if kind=='call' else 'dash pattern=on 3pt off 2pt,-{Straight Barb[length=3.6pt,width=3.2pt]}'
        distance=abs(xa-xb)
        direction=1 if xb>xa else -1
        start=xa+direction*.055 if active(a) else xa
        finish=xb-direction*.055 if active(b) else xb
        # More than one line is reserved in the event grid, keeping arrows legible.
        out += [rf'\draw[{style}] ({start},{ya}) -- ({finish},{ya}) node[midway,above=2pt,align=center,fill=white,inner sep=1.5pt,text width={max(2.5,distance-.25):.2f}cm] {{{esc(label)}}};']
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
('技工所','actor'),(':技工所|接口','boundary'),(':录入义齿|订单控制','control'),(':义齿订单','entity'),(':订单进展','entity'),(':提醒','entity')],[
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

# The report and the ERDs share a single 20-table logical schema.
from database_design import generate_erds, validate_schema
GENERATED.extend(generate_erds())

if __name__=='__main__':
    tables,foreign_keys=validate_schema()
    print(f'Validated {tables} tables and {foreign_keys} foreign keys; generated {len(GENERATED)} native TikZ figures in figures/.')
