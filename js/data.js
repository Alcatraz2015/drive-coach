/* Drive Coach: static content. Edit text here; no logic. */
const COACH={
 controls:{check:['Wrists rest on top of the wheel with arms out, knees slightly bent','Side mirrors just show the edge of the car','Headrest roughly level with the ears, belt across the shoulder, not the neck'],teach:'Do the full setup out loud before every drive until it happens without thinking.'},
 startstop:{check:['Heel stays on the floor and pivots between pedals, right foot only','Brakes early and gently, then eases off just before stopping so the car does not jerk','Stops at the chosen line, not past it'],teach:'"Squeeze, don\'t stomp." Pick a line in the lot and practise stopping exactly on it, over and over.'},
 steer:{check:['Hands at 9 and 3','Push-pull or hand-over-hand in turns, no palming the wheel','Lets the wheel slide back smoothly after a turn instead of letting go'],teach:'Eyes lead the hands. Look where you want to go, not at the hood.'},
 reverse:{check:['Looks back over the right shoulder through the rear window, not just the camera','Walking speed, foot covering the brake','Small steering corrections'],teach:'The back of the car goes the way the top of the wheel turns. Practise in the lot before any street.'},
 rturn:{check:['Signals well before the turn','Slows down before turning, not during','Stays close to the curb and finishes in the nearest lane','Checks for people and bikes on the right'],teach:'Brake while the wheels are straight, then gently accelerate out of the turn.'},
 lturn:{check:['Signals and checks oncoming traffic','Keeps wheels straight while waiting, so a hit from behind does not push the car into traffic','Turns into the nearest lane'],teach:'Say "now" out loud on each gap. Agree before committing until the driver’s judgment matches yours.'},
 stops:{check:['Complete stop behind the stop line or crosswalk, the car settles back','If the view is blocked, creeps forward and stops again','Looks left, right, left before going'],teach:'Count "one-thousand-one" at zero km/h. Rolling stops are a common road test fail.'},
 fourway:{check:['First to stop goes first','Arrive at the same time: yield to the vehicle on the right','Watches for drivers who do not follow the rules'],teach:'Name out loud who goes next before anyone moves.'},
 unprot:{check:['Waits with wheels straight','Turns only into a gap they’re sure of','If the light changes while waiting in the intersection, finishes the turn once oncoming traffic stops'],teach:'Start at quiet intersections. Point out the gaps that could have worked, without pushing to take them.'},
 amber:{check:['Stops if it can be done safely','Goes only if already past the point where stopping would be sudden','Watches pedestrian countdowns to spot a "stale" green'],teach:'On approach, ask "stop or go if it turns now?" so the decision is made before the light changes.'},
 shoulder:{check:['Quick head turn to the blind spot, eyes back forward within a second','Before every lane change, pulling away from the curb, and turning across a bike lane'],teach:'Say "shoulder?" each time until it happens without the prompt. Missing it is one of the most common road test faults.'},
 lanechg:{check:['Mirror, signal, shoulder check, then move','Moves over gradually at steady speed','Cancels the signal after'],teach:'Use the order SMOG: Signal, Mirrors, Over the shoulder, Go.'},
 following:{check:['When the car ahead passes a pole, you reach it 2 or more seconds later','Leaves 4 or more seconds on snow, ice or rain'],teach:'Make it a game: count out loud whenever the supervisor says "count".'},
 speed:{check:['Calgary residential streets are 40 km/h unless signed otherwise','Playground zones are 30 km/h, 7:30 a.m. to 9 p.m. every day','Matches traffic flow without going over'],teach:'Glance at the speedometer every block and say the speed out loud.'},
 zones:{check:['Spots playground and school zone signs without help','Is down to 30 km/h at the sign, not after','Watches for kids between parked cars'],teach:'Ask "what zone are we in?" every time you pass a sign.'},
 round:{check:['Slows down early and picks the lane by exit before entering','Yields to traffic already inside, which comes from the left','Never stops inside, signals right before the exit'],teach:'Drive the roundabout yourself first while narrating, then do single-lane ones until it feels boring.'},
 merge:{check:['Gets up to highway speed on the ramp','Signal, mirror, shoulder check, then merges into a gap','Does not stop at the end of the ramp unless there is no other choice'],teach:'Practise at quiet times like Sunday mornings. Hesitating on the ramp is the danger, not speed.'},
 exit:{check:['Signals early and moves into the exit lane','Slows down on the ramp, not on the highway','If the exit is missed, takes the next one, never brakes or reverses'],teach:'Say the exit name a kilometre ahead so there’s time to plan.'},
 night:{check:['Headlights on from sunset to sunrise and whenever it is hard to see','High beams off when a car is coming or when following close behind'],teach:'Do the first night drive on a route already known well from daytime.'},
 winter:{check:['Smooth gentle steering, braking and gas','Brakes before curves, not in them','Clears all snow and ice off the car before driving'],teach:'After the first snowfall, practise braking and skid feel in an empty lot at low speed.'},
 stall:{check:['Ends up centred in the stall, wheels straight','Signals and checks around before backing out','Moves slowly while backing out and gives way to traffic'],teach:'Use reference points, like: when the stall line lines up with the mirror, start turning.'},
 parallel:{check:['Signals and stops beside the front car, about 1 metre away','Looks over the shoulder while reversing','Finishes close to the curb (about 30 cm) and not touching it'],teach:'Use two cones or empty boxes in the lot before trying it between real cars.'},
 hill:{check:['Downhill with a curb: wheels turned toward the curb','Uphill with a curb: wheels turned away from the curb','No curb: wheels toward the edge of the road','Parking brake on'],teach:'"Up, up and away": uphill, wheels away from the curb.'},
 threept:{check:['Only on a quiet street with a clear view both ways','Signals, checks both ways, turns full lock','Stops before touching the curb each time, looks behind when reversing'],teach:'Talk it through as three separate moves before starting.'}
};
const LEVELS=['Not yet','Learning','With help','Solid'];
const SKILLS=[
 ['Car basics',[['controls','Seat, mirrors & controls check'],['startstop','Smooth starts & stops'],['steer','Steering & hand position'],['reverse','Reversing in a straight line']]],
 ['Turns & intersections',[['rturn','Right turns'],['lturn','Left turns'],['stops','Full stop behind the line'],['fourway','Right-of-way at 4-way stops'],['unprot','Unprotected left turns'],['amber','Amber light decisions']]],
 ['Lanes & traffic',[['shoulder','Shoulder checks'],['lanechg','Lane changes'],['following','Following distance (2–3 s)'],['speed','Holding the limit'],['zones','School & playground zones (30)']]],
 ['Bigger roads',[['round','Roundabouts'],['merge','Highway merge'],['exit','Highway exit'],['night','Driving after dark'],['winter','Snow & ice handling']]],
 ['Parking',[['stall','Stall parking (forward & reverse)'],['parallel','Parallel parking'],['hill','Hill parking, wheels turned'],['threept','Three-point turn']]]
];
const TEMPLATES=[
 {name:'Empty lot basics',stage:'Stage 1',goal:'A big empty parking lot early morning or evening. No traffic, just the car.',
  cps:[['Controls check','Seat, mirrors, belt. Find gas, brake, signals, wipers, lights.'],['Smooth starts and stops','Creep forward, stop smoothly. Repeat until stops feel gentle.'],['Loops both ways','Circle the lot both ways. Hand-over-hand steering.'],['Forward stall parking','Park forward into a stall, centred. Then reverse out.'],['Straight reversing','Reverse in a straight line about 5 stalls, looking over the shoulder.'],['Reverse stall parking','Back into a stall using mirrors and shoulder checks.']]},
 {name:'Quiet neighbourhood',stage:'Stage 2',goal:'Quiet residential crescents: stop signs, turns and playground zones. Calgary residential limit is 40 km/h.',
  cps:[['First stop sign','Full stop behind the line, count 2, look L-R-L.'],['Right turn','Signal early, slow before the turn, finish in the right lane.'],['Left turn','Signal, check oncoming, turn into the nearest lane.'],['Playground zone','Hold 30. Watch for kids between parked cars.'],['4-way stop','Who arrived first goes first. Tie: yield to the right.'],['Back home','Park at the curb, wheels within 30 cm.']]},
 {name:'Traffic lights & lanes',stage:'Stage 3',goal:'Collector roads with signals and two lanes each way, steady traffic.',
  cps:[['First signal','Approach a stale green ready to stop.'],['Lane change','Mirror, signal, shoulder check, move. Cancel the signal.'],['Left on green','Wait in the intersection only if safe; turn when clear.'],['Right on red','Full stop first, then yield to everyone.'],['Busy stretch','Keep 2–3 s following distance. Count it out loud.']]},
 {name:'Roundabouts',stage:'Stage 4',goal:'Nearest roundabouts. Single lane first, then double.',
  cps:[['Approach','Slow early, pick the lane by exit before you arrive.'],['Yield line','Yield to traffic already inside, look left.'],['Exit','Signal right before your exit, check the bike lane.']]},
 {name:'Highway merge',stage:'Stage 5',goal:'Stoney Trail or Deerfoot: on at one ramp, off at the next exit and back. Only when stages 1–3 feel solid.',
  cps:[['On-ramp','Get up to highway speed on the ramp.'],['Merge point','Mirror, signal, shoulder check, find the gap, go.'],['Cruise','Hold the limit in the right lane. Scan far ahead.'],['Exit ramp','Signal early, slow down on the ramp, not on the highway.']]},
 {name:'Road test run',stage:'Stage 6',goal:'A full loop like the real road test. The supervisor stays quiet; the driver does everything.',
  cps:[['Pre-trip','Explain the controls out loud.'],['Parallel park','Within 30 cm of the curb, no more than 3 corrections.'],['Hill park','Wheels turned the right way, parking brake on.'],['Three-point turn','Signal, check both ways, finish in the right lane.'],['Mixed drive','Lights, school zone, lane change, finish back at start.']]}
];

const FLAGS={
 'Hard brake':{skill:'startstop',tip:'Look further ahead and start braking earlier and lighter. Stop like there is a coffee on the dash.'},
 'Late signal':{skill:'lanechg',tip:'Signal 3–5 seconds before every turn and lane change, then make sure it cancels.'},
 'Missed shoulder check':{skill:'shoulder',tip:'Mirror, signal, shoulder check, go. Every lane change and every turn across a bike lane.'},
 'Too fast':{skill:'speed',tip:'Glance at the speedometer every block. Calgary residential streets are 40 km/h, playground zones 30.'},
 'Rolled the stop':{skill:'stops',tip:'Stop fully behind the line, count one-one-thousand, then look left, right, left.'},
 'Wide turn':{skill:'rturn',tip:'Slow down before the turn, look where you want to go, and finish in the nearest lane.'},
 'Drifting in lane':{skill:'steer',tip:'Eyes far down the lane, not on the hood. Small, early corrections.'},
 'Nice job':{good:true}
};
const FEEL=['','Rough','Nervous','Okay','Good','Great'];

const MISTAKES=Object.keys(FLAGS).filter(k=>!FLAGS[k].good);

const AREAS=[
 {id:'calgary',name:'Calgary',c:[51.0447,-114.0719],z:12},
 {id:'mahogany',name:'Mahogany (SE Calgary)',c:[50.900,-113.925],z:14},
 {id:'airdrie',name:'Airdrie',c:[51.2917,-114.0144],z:13},
 {id:'cochrane',name:'Cochrane',c:[51.189,-114.467],z:13},
 {id:'okotoks',name:'Okotoks',c:[50.726,-113.975],z:13},
 {id:'chestermere',name:'Chestermere',c:[51.050,-113.823],z:13}];

/* Which skills each stage trains (used for "suggested next lesson"). */
const STAGE_SKILLS={1:['controls','startstop','steer','reverse','stall'],2:['rturn','lturn','stops','fourway','zones','speed'],
  3:['shoulder','lanechg','following','amber','unprot'],4:['round'],5:['merge','exit'],6:['parallel','hill','threept']};

/* Alberta Class 7 learner rules (source: Alberta GDL program, as summarised by Lethbridge Police Service, checked Oct 2026). */
const RULES={
  noDriveFrom:0, noDriveTo:5,          // no driving 12:00 a.m. – 5:00 a.m.
  minLearnerDays:365,                  // hold Class 7 at least one year before the Class 5-GDL road test
  checklist:['Supervisor is 18+ with a full (non-GDL) licence and sits in the front passenger seat',
             'Zero alcohol and drugs for the learner','No more passengers than seat belts','Learner licence is in the car']
};
/* Calgary default speed on residential streets with no posted sign (since 2021). */
const CALGARY_BOX=[50.84,-114.32,51.22,-113.86], CALGARY_RES_LIMIT=40;
if(typeof module!=='undefined')module.exports={COACH,LEVELS,SKILLS,TEMPLATES,FLAGS,FEEL,MISTAKES,AREAS,STAGE_SKILLS,RULES,CALGARY_BOX,CALGARY_RES_LIMIT};
