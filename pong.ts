/*
Name: Joseph Chun Hoe Loo
Student ID: 30533783
FIT2102 Assignment 1
*/ 

import { interval, fromEvent} from 'rxjs'
import { map, scan, filter, merge} from 'rxjs/operators'

const
	Constants = new class {
		readonly CanvasSize = 600
		readonly PaddleXPosition = 50
		readonly PaddleYPosition = 280
		readonly PaddleWidth = 7
		readonly PaddleHeight = 40
		readonly PaddleVelocity = 3
		readonly BallSize = 8
		readonly BallVelocity = 4
		readonly BallStartAngle = 35
		readonly NextBallAngle = 90
		readonly MaxScore = 7
		readonly RoundWait = 100
		readonly GameWait = 300
	}

type Key = 'ArrowUp' | 'ArrowDown'
type Event = 'keyup' | 'keydown'
type ViewType = 'paddle' | 'ball'
type Role = 'player' | 'enemy' | 'ball'

/* 
This code is heavily inspired by the code from https://tgdwyer.github.io/asteroids/. 
This function is the main starting point of this whole program which constructs the observables streams needed for user input
and ultimately displaying the full game, after calculating the logic, to the user. 
*/
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
		prev_pos: Vec,  // Previous position needed to later determine if the ball is moving downwards or upwards
		pos: Vec, 
		vel: Vec,
		angle: number
	}>

	type State = Readonly<{
		time: number,
		player: Body,
		enemy: Body,
		ball: Body,
		playerScore: number,
		enemyScore: number,
		playerWins: number,
		enemyWins: number,
		round: number,
		restart_at: number,  // The time at which a new round will restart at
		restart_game_at: number,  // The time at which a new game will restart at
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

		startBall = createRectangle('ball') ('ball') 
								   (Constants.BallSize) (Constants.BallSize) 
								   (new Vec(Constants.CanvasSize / 2 - Constants.BallSize / 2, Constants.CanvasSize / 2- Constants.BallSize / 2)) 
								   (Vec.unitVecInDirection(Constants.BallStartAngle).scale(Constants.BallVelocity)) (Constants.BallStartAngle),

		initialState: State = {
			time: 0,
			player: player,
			enemy: enemy,
			ball: startBall,
			playerScore: 0,
			enemyScore: 0,
			playerWins: 0,
			enemyWins: 0,
			round: 1,
			restart_at: 0,  
			restart_game_at: 0,  
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

				// Provide some margin for error for the ball to rebound on the wall
				ballCollideWall = s.ball.pos.y <= Constants.BallSize || s.ball.pos.y + Constants.BallSize >= Constants.CanvasSize - Constants.BallSize,

				ballReboundPaddle = (paddle: Body): Body => { 
					const
						ballMovingDownwards = s.ball.prev_pos.y < s.ball.pos.y,
						ballAtTopHalfOfPaddle = s.ball.pos.y + (Constants.BallSize/2) <= paddle.pos.y + (Constants.PaddleHeight/2),
						opppositeAngle = 180+s.ball.angle,
						reboundAngle = 360-s.ball.angle,
						opppositeVelocity = Vec.unitVecInDirection(opppositeAngle).scale(Constants.BallVelocity),
						reboundVelocity = Vec.unitVecInDirection(reboundAngle).scale(Constants.BallVelocity)

						// Ball moving downwards and hit TOP half of paddle: the ball moves backwards to initial direction
						// Ball moving downwards and hit BOTTOM half of paddle: the ball rebounds normally
						// Ball moving upwards and hit TOP half of paddle: the ball rebounds normally
						// Ball moving upwards and hit BOTTOM half of paddle: the ball moves backwards to initial direction
					return  ballMovingDownwards &&  ballAtTopHalfOfPaddle ? <Body> {...s.ball, 
								prev_pos: s.ball.pos, pos: s.ball.pos.add(opppositeVelocity), vel: opppositeVelocity, angle: opppositeAngle} : 
							ballMovingDownwards && !ballAtTopHalfOfPaddle ? <Body> {...s.ball, 
								prev_pos: s.ball.pos, pos: s.ball.pos.add(reboundVelocity), vel: reboundVelocity, angle: reboundAngle} : 
							!ballMovingDownwards && ballAtTopHalfOfPaddle ? <Body> {...s.ball,
								prev_pos: s.ball.pos, pos: s.ball.pos.add(reboundVelocity), vel: reboundVelocity, angle: reboundAngle} :
							<Body> {...s.ball, prev_pos: s.ball.pos, pos: s.ball.pos.add(opppositeVelocity), vel: opppositeVelocity, angle: opppositeAngle}
				},

				ballReboundWall = (): Body => {
					const 
						angle = 180-s.ball.angle,
						reboundVelocity = Vec.unitVecInDirection(angle).scale(Constants.BallVelocity)
					
					return <Body>{...s.ball, prev_pos: s.ball.pos, pos: s.ball.pos.add(reboundVelocity), vel: reboundVelocity, angle: angle}
					
				},

				ballRebound = (s: State): Body => {
					return ballCollidePlayer ? 
						ballReboundPaddle(s.player) :
					ballCollideEnemy ? 
						ballReboundPaddle(s.enemy) :
					ballCollideWall ? 
						ballReboundWall() :
					<Body>{...s.ball}  // Return the ball at the same state if no collision
				},  
			
			newBallState = ballRebound(s)
			return <State>{
				...s,
				ball: newBallState
      		}
		},
		handleScoring = (s: State): State => {
			const
				enemyScored = s.ball.pos.x < 1,
				playerScored = s.ball.pos.x > Constants.CanvasSize-1,
				playerWon = playerScored ? s.playerScore + 1 === Constants.MaxScore : false,
				enemyWon = enemyScored ? s.enemyScore + 1 === Constants.MaxScore : false
			
			// State object to update the winnner of the game
			return playerWon ? <State> {...s, playerScore: s.playerScore + 1, playerWins: s.playerWins + 1, restart_game_at: s.time + Constants.GameWait, gameOver: playerWon} :
					enemyWon ? <State> {...s, enemyScore: s.enemyScore + 1, enemyWins: s.enemyWins + 1, restart_game_at: s.time + Constants.GameWait, gameOver: enemyWon} :

			// State object to update the winner of the round
					playerScored ? <State>{...s, ball: {...startBall, vel: Vec.Zero}, playerScore: s.playerScore + 1, round: s.round + 1, restart_at: s.time + Constants.RoundWait, gameOver: playerWon} : 
					enemyScored ? <State>{...s, ball: {...startBall, vel: Vec.Zero}, enemyScore: s.enemyScore + 1, round: s.round + 1, restart_at: s.time + Constants.RoundWait, gameOver: enemyWon} : 
								  <State>{...s}
		},
		handleEnemyMovement = (s: State): State => {
			const
				ballWithinPaddle = s.ball.pos.y > s.enemy.pos.y && s.ball.pos.y < s.enemy.pos.y + Constants.PaddleHeight,
				ballHigherThanEnemy = s.ball.pos.y < s.enemy.pos.y

			// Enemy paddle is intentionally put at 9/10 of the original speed as to make it possible for player to score
			return {...s, enemy: {...s.enemy, vel: ballWithinPaddle ? Vec.Zero :  // Paddle doesn't need to move if ball is already within it
												   ballHigherThanEnemy ? new Vec(0, -1).scale(Constants.PaddleVelocity*9/10) :  // Paddle will try to reach ball if ball is above/below it
																		 new Vec(0, 1).scale(Constants.PaddleVelocity*9/10)}}
		},
		handleBetweenRounds = (s: State): State => {
			const 
				pause = s.restart_at > s.time,
				restart = s.restart_at === s.time,
				angle = Constants.BallStartAngle + (Constants.NextBallAngle * s.round)

			// The round will be put on hold until the time reaches when it is supposed to be continue again
			return pause ?   {...s, ball: {...s.ball, vel: Vec.Zero}} :
				   restart ? {...s, ball: {...startBall, vel: Vec.unitVecInDirection(angle).scale(Constants.BallVelocity), angle: angle}} :
				   			 {...s}
		},
		handleBetweenGames = (s: State): State => {
			const
				gameEnded = s.restart_game_at > s.time,
				restart = s.restart_game_at === s.time && s.time > 0
			
			// The round of the new game will be put on hold and will show final score of previous game for 3 seconds 
			// Most values are kept except the scores, round, the ball and value indicating the game is over(gameOver)
			return  gameEnded ? {...s, ball: {...startBall, vel: Vec.Zero}} : 
					restart ? {...s, ball: {...startBall, vel: Vec.unitVecInDirection(Constants.BallStartAngle).scale(Constants.BallVelocity), angle: Constants.BallStartAngle}, playerScore: 0, enemyScore: 0, round: 1, gameOver: false} :
							 {...s}
		},
		tick = (s: State, elapsed: number) => {
			return handleBetweenGames(
					handleBetweenRounds(
					handleScoring(
					handleCollisions(
					handleEnemyMovement(
				{
					...s, 
					time: elapsed,
					player: moveObj(s.player),
					enemy: moveObj(s.enemy),
					ball: moveObj(s.ball)
				}
			)))))
		},
		reduceState = (s: State, e: Move | Tick): State => 
			e instanceof Move ? {...s,
				player: {...s.player, vel: new Vec (0, e.direction).scale(Constants.PaddleVelocity)}
			} :
			tick(s, e.elapsed)
		
		// All necessary observable streams are merged, scanned to accumulate the changes necessary, and subscribed to display the changes to the user through updateView
		interval(10).pipe(
			map(elapsed => new Tick(elapsed)),
			merge(startUp, startDown, stopUp, stopDown),
			scan(reduceState, initialState)).
			subscribe(updateView)
	
	// This function is essentially displaying the pong game to the user
	function updateView(s: State) {
		const 
			svg = document.getElementById("canvas")!,
			player = document.getElementById("player_paddle")!,
			enemy = document.getElementById("enemy_paddle")!,
			player_score = document.getElementById("player_score")!,
			enemy_score = document.getElementById("enemy_score")!,
			player_wins = document.getElementById("player_wins")!,
			enemy_wins = document.getElementById("enemy_wins")!,
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

		// Update the number of wins if any player has recently won
		player_wins.textContent = String(s.playerWins)
		enemy_wins.textContent = String(s.enemyWins)

		
		// This means either player or enemy has scored 7 points. 
		// The observable stream will be unsubscribed and a message stating who won would be displayed
		if (s.gameOver) {
			const v = document.createElementNS(svg.namespaceURI, "text")!
			// Different x so as to align end mesaage properly as one is longer than the other
			s.playerScore == Constants.MaxScore ? v.setAttribute('x', String(Constants.CanvasSize/4)) : v.setAttribute('x', String(Constants.CanvasSize/6))
			v.setAttribute('y', String(Constants.CanvasSize/2))
			v.setAttribute('class', "end_message")
			s.playerScore === Constants.MaxScore ? v.textContent = "Player Won" : v.textContent = "Computer Won"
			svg.appendChild(v)
			const removeChild = () => svg.removeChild(v)
			setTimeout(removeChild, 100)  // Remove the end message as soon as a new game starts
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
// This class simulates the movements of all elements in this game such as the position of the elements and its velocity. 
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