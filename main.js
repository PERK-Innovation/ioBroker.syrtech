"use strict";

/*
 * Created with @iobroker/create-adapter v2.3.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");
const axios = require('axios');

// Load your modules here, e.g.:
// const fs = require("fs");

class Syrtech extends utils.Adapter {

	/**
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	constructor(options) {
		super({
			...options,
			name: "syrtech",
		});
		this.on("ready", this.onReady.bind(this));
		this.on("stateChange", this.onStateChange.bind(this));
		// this.on("objectChange", this.onObjectChange.bind(this));
		// this.on("message", this.onMessage.bind(this));
		this.on("unload", this.onUnload.bind(this));
	} 

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	async onReady() {
		this.connectionCheckInterval = setInterval(() => this.checkConnection(), 5000);

		this.log.info("config ip: " + this.config.ip);

		this.setObjectNotExistsAsync("shutoffState", {
			type: "state",
			common: {
				name: "Shutoff State",
				type: "number",
				role: "indicator",
				read: true,
				write: true,
			},
			native: {},
		});

		this.subscribeStates("shutoffState");
	}

	onUnload(callback) {
		try {
			this.setState("info.connection", false, true);
			this.log.info("Connection to device lost.");
			callback();
		} catch (e) {
			callback();
		}
	}


	async checkConnection() {
		const url = this.getCommandUrl(this.config.ip, "get", "AB", "");
		try {
			axios.get(url);
			this.setState("info.connection", true, true);
			this.log.info("Connection to device established.");
		} catch (error) {
			this.setState("info.connection", false, true);
			this.log.error("Failed to connect to device: " + error);
		}
	}

	/**
	 * Is called if a subscribed state changes
	 * @param {string} id
	 * @param {ioBroker.State | null | undefined} state
	 */
	onStateChange(id, state) {
		if (state) {
			this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

			if (id.endsWith('shutoffState') && !state.ack) {
				// The state was changed by the user, we need to send the new state to the device
				try {
					const newState = state.val;
					this.setShutoffState(this.config.ip, newState);
				} catch (error) {
					this.log.error(`Error setting shutoff state: ${error}`);
				}
			}
		} else {
			this.log.info(`state ${id} deleted`);
		}
	}

	getCommandUrl(ipAddress, action, command, parameter) {
		return `http://${ipAddress}:5333/safe-tec/${action}/${command}/${parameter}`;
	}

	async setShutoffState(ip, state) {
		const url = this.getCommandUrl(ip, 'set', 'AB', state);
		const response = axios.get(url);
		const data = (await response).data;

		this.log.info(`Response from device: ${JSON.stringify(data)}`);

		this.setStateAsync('shutoffState', { val: state, ack: true });
	}

}

if (require.main !== module) {
	module.exports = (options) => new Syrtech(options);
} else {
	new Syrtech();
}