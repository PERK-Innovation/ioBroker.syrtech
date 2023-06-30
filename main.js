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

		this.setObjectNotExistsAsync("profileName", {
			type: "state",
			common: {
				name: "Profile Name",
				type: "string",
				role: "indicator",
				read: true,
				write: true
			},
			native: {},
		});

		this.subscribeStates("shutoffState");
		this.subscribeStates("selectProfile");
		this.subscribeStates("profileName");

		this.updateAll();
	}

	async updateAll() {
		// Update the current profile status when the adapter starts
		await this.getSelectProfile(this.config.ip);
		
		// Update the profiles when the adapter starts
		await this.updateProfiles(this.config.ip);

		// Update the profiles name when the adapter starts
		await this.updateProfileNameStatus(this.config.ip);

		// Update the profiles properties when the adapter starts
		await this.updateProfileProperties(this.config.ip);
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

			if (id.endsWith('profileName') && !state.ack) {
				try {
					const newName = state.val;
					this.setProfileNameStatus(this.config.ip, newName);
				} catch (error) {
					this.log.error(`Error setting profile name: ${error}`);
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
			// await this.getSelectProfile(ip);
			await this.updateAll();
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
	
	updateProfileNameChannel(response) {
		const keys = Object.keys(response);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			if (key.startsWith("getPN")) {
				let profileName = response[key];
				profileName = profileName.slice(0, -1); // Remove the trailing slash
				this.setStateAsync('profileName', { val: profileName, ack: true });
				break;
			}
		}
	}
	
	
	async updateProfileNameStatus(ipAddress) {
		const selectedProfile = await this.getCurrentSelectedProfile(ipAddress);
		const url = this.getCommandUrl(ipAddress, "get", "PN" + selectedProfile, "");
		const response = await axios.get(url);
		const data = response.data; // Changed this line
		this.updateProfileNameChannel(data);
	}
	
	async setProfileNameStatus(ipAddress, newName) {
		const selectedProfile = await this.getCurrentSelectedProfile(ipAddress);
		const url = this.getCommandUrl(ipAddress, "set", "PN" + selectedProfile + "/" + newName, "");
		const response = await axios.get(url);
		const data = response.data; // Changed this line
		this.updateProfileNameChannel(data);
	}
	
	async getCurrentSelectedProfile(ipAddress) {
		const url = this.getCommandUrl(ipAddress, "get", "PRF", "");
		const response = await axios.get(url);
		const data = response.data; // Changed this line
		return data.getPRF;
	}
	
	async updateProfileProperties(ipAddress) {
		const currentProfile = await this.getCurrentSelectedProfile(ipAddress);
		const properties = ['PV', 'PT', 'PF', 'PR', 'PM', 'PB', 'PW', 'ALA', 'VLV'];
		const propertyNames = ['profileVolumeLevel', 'profileTimeLevel', 'profileMaxFlow', 'profileReturnTime', 'profileMicroleakage', 'profileBuzzerOn', 'profileLeakageWarningOn', 'ongoingAlarm', 'currentValveStatus'];
	
		for (let i = 0; i < properties.length; i++) {
			const property = properties[i];
			const propertyName = propertyNames[i];
			try {
				let url;
				if (property === 'ALA' || property === 'VLV') {
					url = this.getCommandUrl(ipAddress, "get", property, "");
				} else {
					url = this.getCommandUrl(ipAddress, "get", property + currentProfile, "");
				}
				this.log.info(`Fetching URL: ${url}`);  // Log the URL being fetched
				const response = await axios.get(url);
				const data = response.data;
	
				this.log.info(`Response from device for property ${property}: ${JSON.stringify(data)}`);
	
				// Create an object for the property if it doesn't exist yet
				await this.setObjectNotExistsAsync(propertyName, {
					type: 'state',
					common: {
						name: propertyName,
						type: 'string',
						role: 'indicator',
						read: true,
						write: false,
					},
					native: {},
				});
	
				// Update the state of the property
				let value;
				if (property === 'ALA') {
					value = this.getAlarmMeaning(data['get' + property]);
				} else if (property === 'VLV') {
					value = this.getValveStatusMeaning(data['get' + property]);
				} else {
					value = data['get' + property + currentProfile];
				}
				this.setStateAsync(propertyName, { val: value, ack: true });
			} catch (error) {
				this.log.error(`Error updating profile property ${property}: ${error}`);
			}
		}
	}
	
	// Method to convert alarm code to its meaning
	getAlarmMeaning(alarmCode) {
		switch (alarmCode) {
			case "FF":
				return "NO ALARM";
			case "A1":
				return "ALARM END SWITCH";
			case "A2":
				return "NO NETWORK";
			case "A3":
				return "ALARM VOLUME LEAKAGE";
			case "A4":
				return "ALARM TIME LEAKAGE";
			case "A5":
				return "ALARM MAX FLOW LEAKAGE";
			case "A6":
				return "ALARM MICRO LEAKAGE";
			case "A7":
				return "ALARM EXT. SENSOR LEAKAGE";
			case "A8":
				return "ALARM TURBINE BLOCKED";
			case "A9":
				return "ALARM PRESSURE SENSOR ERROR";
			case "AA":
				return "ALARM TEMPERATURE SENSOR ERROR";
			case "AB":
				return "ALARM CONDUCTIVITY SENSOR ERROR";
			case "AC":
				return "ALARM TO HIGH CONDUCTIVITY";
			case "AD":
				return "LOW BATTERY";
			case "AE":
				return "WARNING VOLUME LEAKAGE";
			case "AF":
				return "ALARM NO POWER SUPPLY";
			default:
				return "Unknown alarm code";
		}
	}

	// Method to convert valve status code to its meaning
	getValveStatusMeaning(valveStatusCode) {
		switch (valveStatusCode) {
			case "10":
				return "Closed";
			case "11":
				return "Closing";
			case "20":
				return "Open";
			case "21":
				return "Opening";
			case "30":
				return "Undefined";
			default:
				return "Unknown valve status code";
		}
	}
}

if (require.main !== module) {
	module.exports = (options) => new Syrtech(options);
} else {
	new Syrtech();
}