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
				states: {
					1: "Closed",
					2: "Open"
				}
			},
			native: {},
		});

		this.setObjectNotExistsAsync("selectProfile", {
			type: "state",
			common: {
				name: "Select Profile",
				type: "number",
				role: "indicator",
				read: true,
				write: true,
				min: 1,
				max: 8
			},
			native: {},
		});

		this.subscribeStates("shutoffState");
		this.subscribeStates("selectProfile");

		// Update the current profile status when the adapter starts
		this.getSelectProfile(this.config.ip);
		
		// Update the profiles when the adapter starts
		this.updateProfiles(this.config.ip);
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
			clearInterval(this.connectionCheckInterval);
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

			if (id.endsWith('selectProfile') && !state.ack) {
				try {
					const newProfile = state.val;
					this.setSelectProfile(this.config.ip, newProfile);
				} catch (error) {
					this.log.error(`Error setting select profile: ${error}`);
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

	async setSelectProfile(ip, profile) {
		const url = this.getCommandUrl(ip, 'set', 'PRF', profile);
		const response = await axios.get(url);
		const data = response.data;

		this.log.info(`Response from device: ${JSON.stringify(data)}`);

		if (data['setPRF' + profile] === 'OK') {
			// Update the profile state in ioBroker after successfully changing the profile
			await this.getSelectProfile(ip);
		}
	}


	async getSelectProfile(ip) {
		const url = this.getCommandUrl(ip, 'get', 'PRF', '');
		const response = await axios.get(url);
		const data = response.data;

		this.log.info(`Response from device: ${JSON.stringify(data)}`);

		if (data.getPRF) {
			this.setStateAsync('selectProfile', { val: data.getPRF, ack: true });
		} else {
			for (let i = 1; i <= 8; i++) {
				if (data['setPRF' + i] === 'OK') {
					this.setStateAsync('selectProfile', { val: i, ack: true });
					break;
				}
			}
		}
	}

	async updateProfiles(ip) {
		const existingProfiles = {};
	
		// Loop through all 8 profiles
		for (let i = 1; i <= 8; i++) {
			const url = this.getCommandUrl(ip, 'get', 'PA' + i, '');
			const response = await axios.get(url);
			const data = response.data;
	
			this.log.info(`Response from device for profile ${i}: ${JSON.stringify(data)}`);
	
			// Create an object for the profile if it doesn't exist yet
			await this.setObjectNotExistsAsync('profile' + i, {
				type: 'state',
				common: {
					name: `Profile ${i}`,
					type: 'boolean',
					role: 'indicator',
					read: true,
					write: false,
				},
				native: {},
			});
	
			// Check if the profile exists
			if (data['getPA' + i] === '1') {
				existingProfiles[i] = true;
	
				// Update the state of the profile
				this.setStateAsync('profile' + i, { val: true, ack: true });
			} else {
				existingProfiles[i] = false;
	
				// If the profile doesn't exist, set its state to false
				this.setStateAsync('profile' + i, { val: false, ack: true });
			}
		}
	
		this.log.info(`Existing profiles: ${JSON.stringify(existingProfiles)}`);
	}	
	
}

if (require.main !== module) {
	module.exports = (options) => new Syrtech(options);
} else {
	new Syrtech();
}