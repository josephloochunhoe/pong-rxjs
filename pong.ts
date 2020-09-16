import { interval, fromEvent, from, zip } from 'rxjs'
import { map, scan, filter, merge, flatMap, takeUntil, take, concat} from 'rxjs/operators'

const
	Constants = new class {
		readonly CanvasSize = 600
		readonly PaddleXPosition = 50
		readonly PaddleYPosition = 285
		readonly PaddleWidth = 7
		readonly PaddleHeight = 30
		readonly PaddleVelocity = 3
		// readonly PaddleAcc = 1
		// readonly BallRadius = 4
		readonly BallSize = 7
		readonly BallVelocity = 3
		readonly MaxScore = 7
	}

type Key = 'ArrowUp' | 'ArrowDown'
type Event = 'keyup' | 'keydown'
type ViewType = 'paddle' | 'ball'
type Role = 'player' | 'enemy' | 'ball'

// This code is heavily inspired by the code from https://tgdwyer.github.io/asteroids/. 
function pong() {
	class Tick { constructor(public readonly elapsed: number) {} }
	class Move { constructor(public readonly direction: number) {} }
	
	const 
		keyObservable = <T>(event: Event, keyCode: Key, result: () => T) =>
    	fromEvent<KeyboardEvent>(document, event).pipe(
			filter(({code}) => code === keyCode),
			filter(({repeat}) => !repeat),
			map(result)
		),

		startUp = keyObservable('keydown', 'ArrowUp', () => new Move(-1)),
		stopUp = keyObservable('keyup', 'ArrowUp', () => new Move(0)), 
		startDown = keyObservable('keydown', 'ArrowDown', () => new Move(1)),
		stopDown = keyObservable('keyup', 'ArrowDown', () => new Move(0))
	
	type Body = Readonly<{
		id: string,
		viewType: ViewType,
		width: number,
		height: number,
		prev_pos: Vec,
		pos: Vec, 
		vel: Vec,
		acc: Vec,
		angle: number
	}>

	type State = Readonly<{
		time: number,
		player: Body,
		enemy: Body,
		ball: Body,
		playerScore: number,
		enemyScore: number,
		scored: boolean,
		gameOver: boolean
	}>

	const 
		createRectangle = (id: Role) => (viewType: ViewType) => 
						  (width: number) => (height: number) => 
						  (pos: Vec) => 
						  (vel: Vec) => (angle: number) =>
		<Body>{
			id: id,
			viewType: viewType,
			width: width,
			height: height,
			prev_pos: Vec.Zero,
			pos: pos, 
			vel: vel,
			angle: angle
		},
		// Give the ball a random angle to move at when a new round has started
		randomAngle = (): number => { 
			if (Math.random() < 0.5) {
				if (Math.random() < 0.5) {
					return 25
				}
				return 155
			} else {
				if (Math.random() < 0.5) {
					return 205
				}
				return 335
			}
		}

	const
		player = createRectangle ('player') ('paddle') 
								 (Constants.PaddleWidth) (Constants.PaddleHeight) 
								 (new Vec(Constants.PaddleXPosition, Constants.PaddleYPosition)) 
								 (Vec.Zero) (0),

		enemy = createRectangle ('enemy') ('paddle') 
								(Constants.PaddleWidth) (Constants.PaddleHeight) 
								(new Vec(Constants.CanvasSize - Constants.PaddleXPosition - Constants.PaddleWidth, Constants.PaddleYPosition)) 
								(Vec.Zero) (0),

		angle = randomAngle(),
		startBall = createRectangle('ball') ('ball') 
								   (Constants.BallSize) (Constants.BallSize) 
								   (new Vec(Constants.CanvasSize / 2, Constants.CanvasSize / 2)) 
								   (Vec.unitVecInDirection(angle).scale(Constants.BallVelocity)) (angle),

		initialState: State = {
			time: 0,
			player: player,
			enemy: enemy,
			ball: startBall,
			playerScore: 0,
			enemyScore: 0,
			scored: false,
			gameOver: false
		},
		
		moveObj = (o: Body): Body => {
			const 
				updatedPos = o.pos.add(o.vel),
				outOfBounds = updatedPos.y <= 0 || updatedPos.y + (o.viewType === 'paddle' ? Constants.PaddleHeight : Constants.BallSize) >= Constants.CanvasSize
		return <Body>{
			...o,
			prev_pos: o.pos,
			pos: outOfBounds ? o.pos : updatedPos
		}},
		handleCollisions = (s: State) => {
			const
				bodiesCollided = (a: Body, b: Body) => (a.pos.x + a.width >= b.pos.x) && 
													   (a.pos.x <= b.pos.x + b.width) &&
													   (a.pos.y + a.height >= b.pos.y) && 
													   (a.pos.y <= b.pos.y + b.height),
				ballCollidePlayer = bodiesCollided(s.player, s.ball),
				ballCollideEnemy = bodiesCollided(s.ball, s.enemy),
				ballCollideWall = s.ball.pos.y <= 3 || s.ball.pos.y + Constants.BallSize >= Constants.CanvasSize - 3,

				ballReboundPaddle = (ball: Body, paddle: Body): Body => { 
					const
						comingFromTop = s.ball.prev_pos.y < s.ball.pos.y,
						opppositeVelocity = Vec.unitVecInDirection(180+ball.angle).scale(Constants.BallVelocity),
						reboundVelocity = Vec.unitVecInDirection(180-ball.angle).scale(Constants.BallVelocity)

						// Ball coming from TOP and hit TOP half of paddle: the ball moves backwards to previous direction
						// Ball coming from TOP and hit BOTTOM half of paddle: the ball moves rebounds normally
						// Ball coming from BOTTOM and hit TOP half of paddle: the ball moves rebounds normally
						// Ball coming from BOTTOM and hit BOTTOM half of paddle: the ball moves backwards to previous direction
						return ball.pos.y + (Constants.BallSize/2) <= paddle.pos.y + (Constants.PaddleHeight/2) ? 
						<Body>{...ball, vel: comingFromTop ? opppositeVelocity : reboundVelocity, angle: comingFromTop ? 180+ball.angle : 180-ball.angle} :
						<Body>{...ball, vel: comingFromTop ? reboundVelocity : opppositeVelocity, angle: comingFromTop ? 180-ball.angle : 180+ball.angle}},

				ballReboundWall = (ball: Body): Body => {
					const 
						reboundVelocity = Vec.unitVecInDirection(180-ball.angle).scale(Constants.BallVelocity)
					
					return ball.prev_pos.x <= ball.pos.x ? <Body>{...ball, prev_pos: ball.pos, pos: ball.pos.add(reboundVelocity), vel: reboundVelocity, angle: 180-ball.angle} :
														   <Body>{...ball, prev_pos: ball.pos, pos: ball.pos.add(reboundVelocity), vel: reboundVelocity, angle: 180-ball.angle}
					
				},

				ballRebound = (s: State): Body => 
											{return ballCollidePlayer ? 
												ballReboundPaddle(s.ball, s.player) :
											ballCollideEnemy ? 
												ballReboundPaddle(s.ball, s.enemy) :
											ballCollideWall ? 
												ballReboundWall(s.ball) : 
											<Body>{...s.ball}},  // Return the ball at the same state if no collision

			newBallState = ballRebound(s)
			console.log(s.ball.pos)
			return <State>{
				...s,
				ball: newBallState
      		}
		},
		handleScoring = (s: State): State => {
			const
				enemyScored = s.ball.pos.x < 10,
				playerScored = s.ball.pos.x > Constants.CanvasSize-10,
				playerWon = playerScored ? s.playerScore + 1 === Constants.MaxScore : false,
				enemyWon = enemyScored ? s.enemyScore + 1 === Constants.MaxScore : false
			
			// When someone scores, the ball needs to be reset in original position for new round
			return playerScored ? <State>{...s, ball: {...startBall, vel: Vec.unitVecInDirection(randomAngle()).scale(Constants.BallVelocity)}, 
																	 playerScore: s.playerScore + 1, gameOver: playerWon} : 
					enemyScored ? <State>{...s, ball: {...startBall, vel: Vec.unitVecInDirection(randomAngle()).scale(Constants.BallVelocity)}, 
																	 enemyScore: s.enemyScore + 1, gameOver: enemyWon} : 
								  <State>{...s}
		},
		handleEnemyMovement = (s: State): State => {
			const
				ballYVelocity = s.ball.vel.y
			return {...s, enemy: {...s.enemy, vel: new Vec(0, ballYVelocity).scale(0.8)}}
		},
		tick = (s: State, elapsed: number) => {
			return handleScoring(handleCollisions(handleEnemyMovement(
				{
					...s, 
					time: elapsed,
					player: moveObj(s.player),
					// enemy: moveObj(handleEnemyMovement(s)),
					enemy: moveObj(s.enemy),
					ball: moveObj(s.ball)
				}
			)))
		},
		reduceState = (s: State, e: Move | Tick): State => 
			e instanceof Move ? {...s,
				player: {...s.player, vel: new Vec (0, e.direction).scale(Constants.PaddleVelocity)}
			} :
			tick(s, e.elapsed)
		
		const subscription = interval(10).pipe(
			map(elapsed => new Tick(elapsed)),
			merge(startUp, startDown, stopUp, stopDown),
			scan(reduceState, initialState)).
			subscribe(updateView)
		
	function updateView(s: State) {
		const 
			svg = document.getElementById("canvas")!,
			player = document.getElementById("player_paddle")!,
			enemy = document.getElementById("enemy_paddle")!,
			player_score = document.getElementById("player_score")!,
			enemy_score = document.getElementById("enemy_score")!,
			updateBallView = (b:Body) => {
				const v = document.getElementById(b.id)
				v.setAttribute('x', String(b.pos.x))
				v.setAttribute('y', String(b.pos.y))
			};
		
		// Update each of the UI elements to the new values
		// Update the movement of the paddles
		player.setAttribute('y', String(s.player.pos.y))
		enemy.setAttribute('y', String(s.enemy.pos.y))
		
		
		// Update the ball's position if still in play
		updateBallView(s.ball)

		// Update the score if any players has scored
		player_score.textContent = String(s.playerScore)
		enemy_score.textContent = String(s.enemyScore)

		// This means either player or enemy has scored 7 points. 
		// The observable stream will be unsubscribed and a message stating who won would be displayed
		if (s.gameOver) {
			subscription.unsubscribe()
			const v = document.createElementNS(svg.namespaceURI, "text")!

			// Different x so as to align end mesaage properly as one is longer than the other
			s.playerScore == Constants.MaxScore ? v.setAttribute('x', String(Constants.CanvasSize/4)) : v.setAttribute('x', String(Constants.CanvasSize/6))
			v.setAttribute('y', String(Constants.CanvasSize/2))
			v.setAttribute('class', "end_message")
			s.playerScore === Constants.MaxScore ? v.textContent = "Player Won" : v.textContent = "Computer Won"
			svg.appendChild(v)
		}
	}
}

// This function is for the 'Control' section of the game where the control buttons will be highlighted pink if a button is clicked in real time.
// It is meant to friendly to the user so they can easily tell which button is meant for which functionality in the game
function showKeys() {
	function showKey(keyCode: Key) {
		const 
			arrowKey = document.getElementById(keyCode)!,
			keyObservable = (e:Event) => 
				fromEvent<KeyboardEvent>(document, e).pipe(filter(({code}) => code === keyCode))
			

		keyObservable('keydown').subscribe(_ => arrowKey.classList.add("highlight"))
		keyObservable('keyup').subscribe(_ => arrowKey.classList.remove("highlight"))
		
	}
	showKey("ArrowUp")
	showKey("ArrowDown")
  }

// the following simply runs your pong function on window load.  Make sure to leave it in place.
if (typeof window != 'undefined')
	window.onload = ()=>{
		pong();
		showKeys();
	}	


// This class was taken directly from https://tgdwyer.github.io/asteroids/.
// This class simulates the movements of all elements in this game such as the position of the elements and the velocity. 
class Vec {
	constructor(public readonly x: number = 0, public readonly y: number = 0) {}
	add = (b:Vec) => new Vec(this.x + b.x, this.y + b.y)
	sub = (b:Vec) => this.add(b.scale(-1))
	len = ()=> Math.sqrt(this.x*this.x + this.y*this.y)
	scale = (s:number) => new Vec(this.x*s,this.y*s)
	ortho = ()=> new Vec(this.y,-this.x)
	rotate = (deg:number) =>
            (rad =>(
                (cos,sin,{x,y})=>new Vec(x*cos - y*sin, x*sin + y*cos)
              )(Math.cos(rad), Math.sin(rad), this)
            )(Math.PI * deg / 180)

	static unitVecInDirection = (deg: number) => new Vec(0,-1).rotate(deg)	
	static Zero = new Vec();
}
	// createBall = ():Body => {
	// 	return {
	// 		id: 'ball',
	// 		viewType: 'ball',
	// 		pos: new Vec(Constants.CanvasSize/2, Constants.CanvasSize/2), 
	// 		vel: Vec.Zero,
	// 		acc: Vec.Zero,
	// 		angle: 0,
	// 		radius: Constants.BallRadius
	// 	}
	// },
	// createPaddle = (role: Role): Body => {
	// 	return {
	// 		id: role,
	// 		viewType: 'paddle',
	// 		pos: role === 'player' ? new Vec(Constants.PaddleXPosition, Constants.CanvasSize/2) : new Vec(Constants.CanvasSize - Constants.PaddleXPosition, Constants.CanvasSize/2),
	// 		vel: Vec.Zero,
	// 		acc: Vec.Zero,
	// 		angle: 0,
	// 		radius: 0
	// 	}
	// },
	
	// const 
	// 	svg = document.getElementById("canvas"),
	// 	player = document.getElementById("player_paddle"),
	// 	enemy = document.getElementById("enemy_paddle"),
	// 	keydown$ = fromEvent<KeyboardEvent>(document, 'keydown'),
	
	// // Function to update the y attribute of the paddle
	// moveY = (paddle: Element, unit: number) => () => {
	// 	const newY = Number(player.getAttribute('y')) + unit
	// 	if (newY < Number(svg.getAttribute('height'))-30 && newY > 0) {
	// 		paddle.setAttribute('y', String(newY))
	// 	}
	// }
	// Creating observable stream to handle movement of paddle
	// const keyObservable = function() {
	// 	return (code: Key, f: () => void) => keydown$.pipe(
	// 		filter(({repeat}) => !repeat),
	// 		filter(({key}) => key === code),
	// 		flatMap(d => interval(10).pipe(
	// 			takeUntil(fromEvent<KeyboardEvent>(document, 'keyup').pipe(
	// 				filter(({key})=>key === code)
	// 			)),
	// 			map(_=>d))
	// 		),
	// 		map(_=>f)
	// 	)
	// }(),

	// Creating observable stream specific to up and down movements of paddle
	// startUp = keyObservable('keydown', 'ArrowUp', moveY(player, -3)), 
	// stopUp = keyObservable('keyup', 'ArrowUp', moveY(player, -3)), 
	// startDown = keyObservable('keydown', 'ArrowDown', moveY(player, 3)),
	// stopDown = keyObservable('keyup', 'ArrowDown', moveY(player, 3)),

	// Merge the streams to be subscribed
	// mergedKeyObservable = up.pipe(merge(down))
	// mergedKeyObservable.subscribe(f => f())