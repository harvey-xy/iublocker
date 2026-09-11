/**
 * Public-suffix snapshot used for `$domain=example.*` / `example.*##…` entity expansion.
 *
 * Hand-curated, ordered by how often the suffix appears in the default filter lists so
 * that `PUBLIC_SUFFIXES.slice(0, ENTITY_EXPANSION_LIMIT)` is a sensible fallback.
 * Regeneration instructions: src/psl/README.md.
 *
 * 1085 entries.
 */
const SNAPSHOT = `
com net org de uk co io ru fr it es nl br jp cn in au ca us pl info biz tv cc me xyz online site club
shop app dev live top pro news blog cloud tech store space icu eu ch be at se dk no fi cz gr pt hu ro bg
hr si sk lt lv ee ie il tr ua kr tw hk sg my id th vn ph nz za mx ar cl pe co.uk com.au co.jp com.br
com.cn co.in co.za com.mx com.ar com.tr co.kr com.tw com.hk co.nz com.sg com.my co.id co.th com.ph
com.vn co.il org.uk ac.uk gov.uk nhs.uk sch.uk ltd.uk plc.uk me.uk net.uk net.au org.au edu.au gov.au
id.au asn.au ne.jp or.jp ac.jp go.jp gr.jp lg.jp ad.jp ed.jp net.br org.br gov.br edu.br art.br blog.br
net.cn org.cn gov.cn edu.cn ac.cn net.hk org.hk idv.hk net.in org.in firm.in gen.in ind.in edu.in gov.in
ac.in net.za org.za web.za gov.za ac.za org.mx net.mx gob.mx edu.mx net.ar org.ar gob.ar edu.ar net.tr
org.tr gov.tr edu.tr bel.tr ne.kr or.kr re.kr pe.kr go.kr ac.kr net.tw org.tw idv.tw game.tw gov.tw
edu.tw net.nz org.nz govt.nz ac.nz geek.nz school.nz net.sg org.sg edu.sg gov.sg per.sg net.my org.my
gov.my edu.my or.id web.id ac.id go.id my.id biz.id sch.id in.th ac.th go.th net.th or.th net.ph org.ph
gov.ph edu.ph net.vn org.vn edu.vn gov.vn org.il net.il ac.il gov.il k12.il muni.il com.ru net.ru org.ru
pp.ru msk.ru spb.ru com.ua net.ua org.ua kiev.ua in.ua com.pl net.pl org.pl edu.pl gov.pl waw.pl info.pl
biz.pl com.es nom.es org.es gob.es edu.es com.pt edu.pt gov.pt com.gr net.gr org.gr edu.gr gov.gr co.at
or.at ac.at gv.at priv.at com.ro org.ro store.ro com.hr com.si com.bg com.rs org.rs co.rs com.ee com.lv
com.lt com.by com.kz com.uz com.ge com.am com.az com.cy com.mt com.al com.mk com.ba com.co net.co org.co
nom.co edu.co gov.co com.pe org.pe net.pe com.ve com.ec com.uy com.py com.bo com.do com.gt com.pa com.sv
com.ni com.hn com.cu com.pr com.ng com.gh com.eg com.sa com.pk com.bd com.np com.lk com.mm com.kh co.ke
co.tz co.ug co.zw co.zm co.mz co.ao co.bw co.ls co.na co.mw com.qa com.kw com.bh com.om com.jo com.lb
com.sy com.ye com.iq com.af com.ai com.ag com.bs com.bb com.bz com.bm com.ky com.jm com.tt com.vc com.lc
com.fj com.pg com.sb com.to com.ws com.vu com.ki com.nf com.de com.im com.gi mil.in res.in nic.in com.tn
com.dz com.ma net.ma org.ma ac.ma mi.th gov.hk edu.hk gov.ua edu.ua co.ve net.ve org.ve info.ve web.ve
aid.pl agro.pl auto.pl gda.pl gdansk.pl krakow.pl lodz.pl poznan.pl szczecin.pl warszawa.pl wroc.pl
wroclaw.pl sos.pl med.pl miasta.pl nom.pl priv.pl realestate.pl rel.pl sex.pl shop.pl sklep.pl sklepy.pl
targi.pl tm.pl tourism.pl travel.pl turystyka.pl ac.be ac.cy ac.im ac.ir ac.ke ac.mu ac.mw ac.ng ac.pa
ac.pr ac.rs ac.ru ac.rw ac.se ac.tj ac.tz ac.ug ac.vn ac.zm ac.zw conf.au info.au csiro.au adm.br adv.br
arq.br bio.br cim.br cng.br cnt.br ecn.br eng.br esp.br etc.br eti.br far.br fm.br fnd.br fot.br fst.br
g12.br ggf.br imb.br ind.br inf.br jor.br lel.br mat.br med.br mil.br mus.br nom.br not.br ntr.br odo.br
ppg.br pro.br psc.br psi.br qsl.br rec.br slg.br srv.br tmp.br trd.br tur.br tv.br vet.br zlg.br ac ad
ae af ag ai al am ao aq as aw ax az ba bb bd bf bh bi bj bm bn bo bs bt bw by bz cd cf cg ci ck cm cr cu
cv cw cx cy dj dm do dz ec eg er et fj fk fm fo ga gd ge gf gg gh gi gl gm gn gp gq gs gt gu gw gy hm hn
ht im iq ir is je jm jo ke kg kh ki km kn kp kw ky kz la lb lc li lk lr ls lu ly ma mc md mg mh mk ml mm
mn mo mp mq mr ms mt mu mv mw mz na nc ne nf ng ni np nr nu om pa pf pg pk pm pn pr ps pw qa re rs rw sa
sb sc sd sh sl sm sn so sr ss st sv sx sy sz tc td tf tg tj tk tl tm tn to tt tz ug uy uz va vc vg vi vu
wf ws ye yt zm zw gb int edu gov mil arpa name aero asia cat coop jobs mobi museum post tel travel xxx
tirol berlin hamburg koeln nrw ruhr saarland bayern cologne wien academy accountant accountants actor
adult agency airforce apartments army art associates attorney auction audio auto autos baby band bank
bar bargains baseball basketball beauty beer best bet bid bike bingo bio black blackfriday boats bond
boo boutique box broker build builders business buzz cab cafe cam camera camp capital cards care career
careers cars casa cash casino catering center ceo chat cheap christmas church city claims cleaning click
clinic clothing coach codes coffee college community company computer condos construction consulting
contact contractors cooking cool coupons courses credit creditcard cricket cruises dad dance data date
dating day deals degree delivery democrat dental dentist design diamonds diet digital direct directory
discount doctor dog domains download earth eat education email energy engineer engineering enterprises
equipment esq estate events exchange expert exposed express fail faith family fan fans farm fashion
feedback film finance financial fish fishing fit fitness flights florist flowers fly foo football
forsale forum foundation fun fund furniture futbol fyi gallery game games garden gay gift gifts gives
giving glass global gmbh gold golf graphics gratis gripe group guide guitars guru hair haus health
healthcare help hiphop hockey holdings holiday homes horse hospital host hosting hot house how immo
immobilien inc industries ink institute insurance insure international investments irish jetzt jewelry
juegos kaufen kim kitchen kiwi land lawyer lease legal lgbt life lighting limited limo link loan loans
locker lol london love ltd ltda luxury maison makeup management market marketing markets mba media
memorial men menu miami moda moe mom money monster mortgage moscow motorcycles movie nagoya navy network
new ngo ninja nyc observer okinawa one onl ooo organic osaka page paris partners parts party pet
pharmacy phd photo photography photos physio pics pictures pink pizza place plumbing plus poker porn
press prof promo properties property pub quest racing realestate realty recipes red rehab reise reisen
reit rent rentals repair report republican rest restaurant review reviews rich rip rocks rodeo rsvp run
sale salon sarl school schule science search security services sex sexy shiksha shoes shopping show
singles ski soccer social software solar solutions soy sport stream studio study style supplies supply
support surf surgery systems tattoo tax taxi team technology tennis theater tickets tienda tips tires
today tokyo tools tours town toys trade trading training tube uno vacations ventures vet viajes video
villas vin vip vision vodka vote voting voyage wang watch webcam website wedding wiki win wine work
works world wtf yachts yoga yokohama zone
`;

/** Ordered most-common-first. */
export const PUBLIC_SUFFIXES: readonly string[] = SNAPSHOT.split(/\s+/).filter((s) => s !== '');

let suffixSet: Set<string> | null = null;

/** Membership test against the snapshot. */
export function isPublicSuffix(suffix: string): boolean {
  if (suffixSet === null) suffixSet = new Set(PUBLIC_SUFFIXES);
  return suffixSet.has(suffix);
}
